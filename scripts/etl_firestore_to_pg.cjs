/**
 * ETL Firestore -> Postgres (FULL RELATIONAL, raw SQL). Idempotent: TRUNCATE rồi nạp lại.
 * Chạy: node scripts/etl_firestore_to_pg.cjs   (cần: docker compose up -d postgres)
 *
 * - Explode mảng-các-object thành bảng con; object lồng → cột phẳng.
 * - n:n qua bảng nối: order_items, order_applied_promotions,
 *   promotion_products, promotion_categories, zalo_group_members.
 * - Resolve tên danh mục → category_id.
 * - Bỏ qua request_logs (ephemeral). Renumber order 267 đúp + bật lại UNIQUE.
 */
const admin = require('firebase-admin');
const postgres = require('postgres');
const sa = require('../service_account.json');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const sql = postgres(process.env.DATABASE_URL || 'postgresql://cucquy:cucquy_dev@localhost:5432/cucquy');

const dt = (v) => {
  if (v == null) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000);
  if (typeof v === 'string') { const d = new Date(v); return isNaN(+d) ? null : d; }
  return null;
};
const J = (v) => (v == null ? null : JSON.stringify(v));
const arr = (v) => (Array.isArray(v) ? v.map(String) : null);
const sval = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
const x = (v) => (v === undefined ? null : v);

const docs = async (name) => (await fs.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ins = async (table, obj) => {
  const clean = {};
  for (const [k, v] of Object.entries(obj)) clean[k] = v === undefined ? null : v;
  await sql`insert into ${sql(table)} ${sql(clean)}`;
};
const insRet = async (table, obj) => {
  const clean = {};
  for (const [k, v] of Object.entries(obj)) clean[k] = v === undefined ? null : v;
  const [row] = await sql`insert into ${sql(table)} ${sql(clean)} returning id`;
  return row.id;
};

(async () => {
  console.log('→ Bỏ tạm FK transactions + UNIQUE(order_number) + TRUNCATE…');
  // transactions.order_number FK phụ thuộc UNIQUE index của orders → drop FK trước.
  await sql`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_order_number_fkey`;
  await sql`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key`;
  await sql`TRUNCATE
    users, customers, categories, recipes, products, product_versions,
    product_version_changes, suppliers, materials, stock_receipts, stock_receipt_lines,
    promotions, promotion_products, promotion_categories, orders, order_items, order_decorations,
    order_gift_items, order_applied_promotions, order_history, order_history_changes,
    transactions, commission_groups, commission_group_tiers, product_badges, order_badges,
    customer_badge_rules, facebook_messages, facebook_message_attachments, screen_visibility,
    shipping_config, shipping_tiers, zalo_config, zalo_groups, zalo_group_members, request_logs
    RESTART IDENTITY CASCADE`;

  const c = {};
  const bump = (k, n = 1) => (c[k] = (c[k] || 0) + n);

  // users / customers / suppliers
  for (const u of await docs('users')) { await ins('users', { uid: u.uid || u.id, email: x(u.email), display_name: x(u.displayName), custom_name: x(u.customName), photo_url: x(u.photoURL), role: x(u.role), status: x(u.status), zalo_ctv_group_chat_id: x(u.zaloCtvGroupChatId), last_login_at: x(u.lastLoginAt), created_at: x(u.createdAt) }); bump('users'); }
  for (const cu of await docs('customers')) { await ins('customers', { id: cu.id, name: cu.name || '(không tên)', phone: x(cu.phone), created_at: dt(cu.createdAt) }); bump('customers'); }
  for (const s of await docs('suppliers')) { await ins('suppliers', { id: s.id, name: x(s.name), normalized_name: x(s.normalizedName), receipt_count: x(s.receiptCount), total_amount: x(s.totalAmount), last_receipt_date: x(s.lastReceiptDate), phone: x(s.phone), address: x(s.address), created_at: dt(s.createdAt), updated_at: dt(s.updatedAt) }); bump('suppliers'); }
  const supplierIds = new Set((await sql`select id from suppliers`).map((r) => r.id));
  const userUids = new Set((await sql`select uid from users`).map((r) => r.uid));

  for (const m of await docs('materials')) { await ins('materials', { id: m.id, name: x(m.name), normalized_name: x(m.normalizedName), canonical_unit: x(m.canonicalUnit), import_count: x(m.importCount), total_qty: x(m.totalQty), total_amount: x(m.totalAmount), last_unit_price: x(m.lastUnitPrice), last_supplier_id: supplierIds.has(m.lastSupplierId) ? m.lastSupplierId : null, last_supplier_name: x(m.lastSupplierName), last_receipt_date: x(m.lastReceiptDate), created_at: dt(m.createdAt), updated_at: dt(m.updatedAt) }); bump('materials'); }
  const materialIds = new Set((await sql`select id from materials`).map((r) => r.id));

  // configurations → categories + badges (3) + screen_visibility + shipping + zalo
  const catByName = new Map();
  for (const cfg of await docs('configurations')) {
    if (Array.isArray(cfg.categories)) {
      await sql.begin(async (sql) => {
        for (const cat of cfg.categories) { await sql`insert into categories ${sql({ id: cat.id, name: cat.name, parent_id: cat.parentId ?? null, icon: x(cat.icon), color: x(cat.color), sort_order: x(cat.sortOrder), description: x(cat.description) })}`; bump('categories'); catByName.set(cat.name, cat.id); }
      });
    } else if (Array.isArray(cfg.productBadges) || Array.isArray(cfg.orderBadges) || Array.isArray(cfg.customerRules)) {
      for (const b of cfg.productBadges || []) { await ins('product_badges', { id: b.id, name: x(b.name), color: x(b.color), icon: x(b.icon), sort_order: x(b.sortOrder), description: x(b.description) }); bump('product_badges'); }
      for (const b of cfg.orderBadges || []) { await ins('order_badges', { id: b.id, name: x(b.name), color: x(b.color), icon: x(b.icon), sort_order: x(b.sortOrder), description: x(b.description) }); bump('order_badges'); }
      for (const r of cfg.customerRules || []) { await ins('customer_badge_rules', { id: r.id, name: x(r.name), color: x(r.color), icon: x(r.icon), rule_type: x(r.ruleType), operator: x(r.operator), threshold: x(r.threshold), sort_order: x(r.sortOrder), description: x(r.description) }); bump('customer_badge_rules'); }
    } else if (cfg.screenVisibility) {
      for (const [route, vis] of Object.entries(cfg.screenVisibility)) { await ins('screen_visibility', { route, visible: !!vis }); bump('screen_visibility'); }
    } else if (cfg.overFee !== undefined || Array.isArray(cfg.tiers)) {
      await ins('shipping_config', { id: 'shipping', over_fee: x(cfg.overFee), over_label: x(cfg.overLabel), shop_origin: J(cfg.shopOrigin) });
      for (let i = 0; i < (cfg.tiers || []).length; i++) { const t = cfg.tiers[i]; await ins('shipping_tiers', { max_km: x(t.maxKm), fee: x(t.fee), label: x(t.label), sort_order: i }); bump('shipping_tiers'); }
    } else if (cfg.mainGroupId !== undefined || Array.isArray(cfg.groups)) {
      await ins('zalo_config', { id: 'zalo', main_group_id: x(cfg.mainGroupId), main_notify_on_create: x(cfg.mainNotifyOnCreate), main_notify_on_update: x(cfg.mainNotifyOnUpdate), main_notify_on_delete: x(cfg.mainNotifyOnDelete), main_update_field_whitelist: arr(cfg.mainUpdateFieldWhitelist) });
      for (const g of cfg.groups || []) {
        await ins('zalo_groups', { id: g.id, name: x(g.name), zalo_group_id: x(g.zaloGroupId), notify_on_create: x(g.notifyOnCreate), notify_on_update: x(g.notifyOnUpdate), notify_on_delete: x(g.notifyOnDelete), update_field_whitelist: arr(g.updateFieldWhitelist) });
        bump('zalo_groups');
        for (const uid of g.memberUids || []) { if (!userUids.has(uid)) continue; await ins('zalo_group_members', { group_id: g.id, user_uid: uid }); bump('zalo_group_members'); }
      }
    }
  }

  // recipes
  const recipeRows = await docs('recipes');
  const recipeIds = new Set(recipeRows.map((r) => r.id));
  await sql.begin(async (sql) => {
    for (const r of recipeRows) { await sql`insert into recipes ${sql({ id: r.id, name: x(r.name), description: x(r.description), instructions: x(r.instructions), yield: x(r.yield), yield_unit: x(r.yieldUnit), waste_rate: x(r.wasteRate), recipe_type: x(r.recipeType), base_recipe_id: recipeIds.has(r.baseRecipeId) ? r.baseRecipeId : null, output_quantity: x(r.outputQuantity), created_at: dt(r.createdAt), updated_at: dt(r.updatedAt) })}`; bump('recipes'); }
  });

  // products (category_id resolve theo tên)
  for (const p of await docs('products')) { await ins('products', { id: p.id, name: p.name || '(không tên)', price: x(p.price), cost_price: x(p.costPrice), description: x(p.description), status: x(p.status), category_id: catByName.get(p.category) ?? null, category: x(p.category), tags: arr(p.tags), image: x(p.image), gallery: arr(p.gallery), recipe_id: recipeIds.has(p.recipeId) ? p.recipeId : null, cakes_per_product: x(p.cakesPerProduct), created_at: dt(p.createdAt) }); bump('products'); }
  const productIds = new Set((await sql`select id from products`).map((r) => r.id));

  // product_versions + diff per field
  for (const v of await docs('product_versions')) {
    await ins('product_versions', { id: v.id, product_id: productIds.has(v.productId) ? v.productId : null, action: x(v.action), edited_at: dt(v.editedAt) });
    bump('product_versions');
    const before = v.before || {}; const after = v.changes || {};
    for (const k of Object.keys(after)) { await ins('product_version_changes', { version_id: v.id, field: k, before_value: sval(before[k]), after_value: sval(after[k]) }); bump('product_version_changes'); }
  }

  // stock_receipts (+ flatten validation/amount_check) + lines
  for (const d of (await fs.collection('stock_receipts').get()).docs) {
    const s = d.data(); const va = s.validation || {}; const ac = s.amountCheck || {};
    await ins('stock_receipts', { id: d.id, supplier_id: supplierIds.has(s.supplierId) ? s.supplierId : null, supplier_name_raw: x(s.supplierNameRaw), supplier_name_canonical: x(s.supplierNameCanonical), store_or_branch: x(s.storeOrBranch), invoice_number: x(s.invoiceNumber), supplier_phone: x(s.supplierPhone), supplier_address: x(s.supplierAddress), receipt_date: x(s.receiptDate), receipt_time: x(s.receiptTime), subtotal: x(s.subtotal), tax: x(s.tax), discount: x(s.discount), total_amount: x(s.totalAmount), currency: x(s.currency), payment_method: x(s.paymentMethod), notes: x(s.notes), product_line_count: x(s.productLineCount), ocr_text: x(s.ocrText), receipt_image_base64: x(s.receiptImageBase64), receipt_image_mime_type: x(s.receiptImageMimeType), validation_is_likely_receipt: x(va.isLikelyReceipt), validation_confidence: x(va.confidence), validation_reason_vi: x(va.reasonVi), validation_heuristic_score: x(va.heuristicScore), validation_heuristic_note_vi: x(va.heuristicNoteVi), amount_check_sum_lines: x(ac.sumLines), amount_check_delta_pct: x(ac.deltaPct), amount_check_warn: x(ac.warn), bill_hash: x(s.billHash), status: x(s.status), created_by_uid: x(s.createdByUid), created_at: dt(s.createdAt), updated_at: dt(s.updatedAt) });
    bump('stock_receipts');
    for (const ld of (await d.ref.collection('lines').get()).docs) { const l = ld.data(); await ins('stock_receipt_lines', { id: ld.id, receipt_id: d.id, material_id: materialIds.has(l.materialId) ? l.materialId : null, material_name_raw: x(l.materialNameRaw), name: x(l.name), quantity: x(l.quantity), unit: x(l.unit), unit_price: x(l.unitPrice), line_total: x(l.lineTotal), supplier_id: x(l.supplierId), receipt_date: x(l.receiptDate), created_at: dt(l.createdAt) }); bump('stock_receipt_lines'); }
  }

  // promotions + junction n:n
  for (const p of await docs('promotions')) {
    await ins('promotions', { id: p.id, name: x(p.name), apply_mode: x(p.applyMode), code: x(p.code), discount_type: x(p.discountType), discount_value: x(p.discountValue), max_discount: x(p.maxDiscount), group_category_id: catByName.get(p.groupCategoryId) ?? null, group_badge_id: x(p.groupBadgeId), buy_quantity: x(p.buyQuantity), get_quantity: x(p.getQuantity), scope: x(p.scope), min_order_value: x(p.minOrderValue), start_at: x(p.startAt), end_at: x(p.endAt), max_uses: x(p.maxUses), used_count: x(p.usedCount), status: x(p.status), priority: x(p.priority), created_by: x(p.createdBy), created_at: x(p.createdAt), updated_at: x(p.updatedAt) });
    bump('promotions');
    for (const pid of p.productIds || []) if (productIds.has(pid)) { await ins('promotion_products', { promotion_id: p.id, product_id: pid }); bump('promotion_products'); }
    for (const cname of p.categoryIds || []) { const cid = catByName.get(cname); if (cid) { await ins('promotion_categories', { promotion_id: p.id, category_id: cid }); bump('promotion_categories'); } }
  }

  // orders (+ flatten customer) + items/decorations/gifts/applied/history
  const customerIds = new Set((await sql`select id from customers`).map((r) => r.id));
  const promotionIds = new Set((await sql`select id from promotions`).map((r) => r.id));
  for (const o of await docs('orders')) {
    const cust = o.customer || {};
    await ins('orders', { id: o.id, order_number: x(o.orderNumber), order_date: dt(o.orderDate), customer_id: cust.id && customerIds.has(cust.id) ? cust.id : null, customer_name: x(o.customerName), phone: x(o.phone), address: x(o.address), email: x(o.email), customer_city: x(cust.city), customer_country: x(cust.country), subtotal: x(o.subtotal), shipping_cost: x(o.shippingCost), discount_amount: x(o.discountAmount), total: x(o.total), payment_status: x(o.paymentStatus), payment_method: x(o.paymentMethod), status: x(o.status), delivery_type: x(o.deliveryType), delivery_date: x(o.deliveryDate), delivery_time: x(o.deliveryTime), note: x(o.note), sepay_id: o.sepayId == null ? null : String(o.sepayId), commission_status: x(o.commissionStatus), commission_paid_at: x(o.commissionPaidAt), is_test: x(o.isTest), created_by: x(o.createdBy), updated_by: x(o.updatedBy), created_at: dt(o.createdAt), updated_at: dt(o.updatedAt) });
    bump('orders');
    for (const it of o.items || []) { await ins('order_items', { order_id: o.id, product_id: productIds.has(it.id) ? it.id : null, product_name: x(it.name), unit_price: x(it.price), quantity: x(it.quantity), image: x(it.image) }); bump('order_items'); }
    for (const d of o.decorations || []) { await ins('order_decorations', { order_id: o.id, name: x(d.name), price: x(d.price), quantity: x(d.quantity) }); bump('order_decorations'); }
    for (const g of o.giftItems || []) { await ins('order_gift_items', { order_id: o.id, product_id: productIds.has(g.productId) ? g.productId : null, name: x(g.name), image: x(g.image), quantity: x(g.quantity), price: x(g.price) }); bump('order_gift_items'); }
    for (const ap of o.appliedPromotions || []) { await ins('order_applied_promotions', { order_id: o.id, promotion_id: promotionIds.has(ap.promotionId) ? ap.promotionId : null, code: x(ap.code), name: x(ap.name), type: x(ap.type), amount: x(ap.amount) }); bump('order_applied_promotions'); }
    for (const h of o.history || []) {
      const hid = await insRet('order_history', { order_id: o.id, at: dt(h.at), by_name: x(h.by), by_uid: x(h.byUid) });
      bump('order_history');
      for (const ch of h.changes || []) { await ins('order_history_changes', { history_id: hid, field: x(ch.field), label: x(ch.label), old_value: sval(ch.oldValue), new_value: sval(ch.newValue) }); bump('order_history_changes'); }
    }
  }

  // transactions
  for (const t of await docs('transactions')) { await ins('transactions', { id: t.id, sepay_id: x(t.sepayId), gateway: x(t.gateway), transaction_date: x(t.transactionDate), account_number: x(t.accountNumber), code: x(t.code), content: x(t.content), transfer_type: x(t.transferType), transfer_amount: x(t.transferAmount), accumulated: x(t.accumulated), sub_account: x(t.subAccount), reference_code: x(t.referenceCode), description: x(t.description), order_number: x(t.orderNumber), is_external: x(t.isExternal), received_at: dt(t.receivedAt), created_at: dt(t.createdAt) }); bump('transactions'); }

  // commission groups + tiers
  for (const cg of await docs('commissionGroups')) {
    await ins('commission_groups', { id: cg.id, name: x(cg.name), min_margin: x(cg.minMargin), max_margin: x(cg.maxMargin), profit_share_rate: x(cg.profitShareRate), fallback_rate: x(cg.fallbackRate), sort_order: x(cg.order) });
    bump('commission_groups');
    for (let i = 0; i < (cg.tiers || []).length; i++) { const t = cg.tiers[i]; await ins('commission_group_tiers', { group_id: cg.id, min_qty: x(t.minQty), profit_share_rate: x(t.profitShareRate), sort_order: i }); bump('commission_group_tiers'); }
  }

  // facebook messages + attachments
  for (const f of await docs('facebook_messages')) {
    await ins('facebook_messages', { id: f.id, id_new_message: x(f.idNewMessage), id_page: x(f.idPage), page_scope_id: x(f.pageScopeId), id_conversion: x(f.idConversion), id_cong_ty: x(f.idCongTy), message: x(f.message), type: x(f.type), is_phone: x(f.isPhone), use_webhook: x(f.useWebhook), url_webhook: x(f.urlWebhook), app_id: x(f.appId), page_name: x(f.pageName), customer_name: x(f.customerName), number_phone: x(f.numberPhone), country_code: x(f.countryCode), sent_by_shop: x(f.sentByShop), ai_disabled: x(f.aiDisabled), content_type: f.content ? x(f.content.type) : null, source_created_at: x(f.sourceCreatedAt), received_at: dt(f.receivedAt), created_at: dt(f.createdAt) });
    bump('facebook_messages');
    for (const a of f.attachment || []) { await ins('facebook_message_attachments', { message_id: f.id, type: x(a.type), url: x(a.url) }); bump('facebook_message_attachments'); }
  }

  // renumber order 267 đúp + bật lại UNIQUE
  console.log('→ Renumber order 267 đúp + bật lại UNIQUE…');
  await sql.begin(async (sql) => {
    await sql`UPDATE orders SET order_number='ORD-'||lpad(((regexp_replace(order_number,'\\D','','g'))::int+1)::text,6,'0') WHERE (regexp_replace(order_number,'\\D','','g'))::int>267 OR id=(SELECT id FROM orders WHERE order_number='ORD-000267' ORDER BY created_at DESC LIMIT 1)`;
    await sql`UPDATE transactions SET order_number='ORD-'||lpad(((regexp_replace(order_number,'\\D','','g'))::int+1)::text,6,'0') WHERE order_number ~ '^ORD-[0-9]+$' AND (regexp_replace(order_number,'\\D','','g'))::int>=267`;
    await sql`ALTER TABLE orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number)`;
    // FK transactions.order_number -> orders.order_number (giờ orders.order_number đã UNIQUE).
    // Null các giao dịch ngoại lệ (không khớp đơn nào) để thêm FK được.
    await sql`UPDATE transactions t SET order_number=NULL WHERE order_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_number=t.order_number)`;
    await sql`ALTER TABLE transactions ADD CONSTRAINT transactions_order_number_fkey FOREIGN KEY (order_number) REFERENCES orders(order_number) ON DELETE SET NULL`;
  });

  console.log('\n=== Đã nạp ===');
  Object.entries(c).sort().forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
  console.log('  (bỏ qua request_logs — ephemeral)');
  await sql.end();
  await admin.app().delete();
})().catch((e) => { console.error(e); process.exit(1); });
