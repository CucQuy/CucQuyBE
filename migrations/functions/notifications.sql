-- ============================================================
-- Domain notifications — nhật ký gửi (Zalo) + hộp thư in-app.
-- Logic ở stored function; service chỉ gọi + map.
-- ============================================================

-- Gói 1 dòng thành jsonb camelCase.
CREATE OR REPLACE FUNCTION notification_to_json(n notifications)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', n.id,
    'kind', n.kind,
    'category', n.category,
    'title', n.title,
    'body', n.body,
    'target', n.target,
    'status', n.status,
    'error', n.error,
    'triggeredBy', n.triggered_by,
    'readAt', n.read_at,
    'createdAt', n.created_at
  );
$$;

-- Ghi 1 thông báo. p_input camelCase: {kind,category,title,body,target,status,error,payload,triggeredBy}. Trả {id}.
CREATE OR REPLACE FUNCTION notification_log(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_id text;
BEGIN
  INSERT INTO notifications (kind, category, title, body, target, status, error, payload, triggered_by)
  VALUES (
    COALESCE(NULLIF(p_input->>'kind',''), 'inapp'),
    NULLIF(p_input->>'category',''),
    NULLIF(p_input->>'title',''),
    NULLIF(p_input->>'body',''),
    NULLIF(p_input->>'target',''),
    COALESCE(NULLIF(p_input->>'status',''), 'sent'),
    NULLIF(p_input->>'error',''),
    CASE WHEN jsonb_typeof(p_input->'payload') IS NOT NULL THEN p_input->'payload' ELSE NULL END,
    NULLIF(p_input->>'triggeredBy','')
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- Danh sách nhật ký (lọc kind/status + khoảng thời gian), phân trang offset. Trả {items,hasMore}.
CREATE OR REPLACE FUNCTION notification_list(
  p_kind text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH page_rows AS (
    SELECT n.* FROM notifications n
    WHERE (p_kind IS NULL OR n.kind = p_kind)
      AND (p_status IS NULL OR n.status = p_status)
      AND (p_from IS NULL OR n.created_at >= p_from)
      AND (p_to IS NULL OR n.created_at <= p_to)
    ORDER BY n.created_at DESC
    LIMIT GREATEST(p_limit, 0) + 1 OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      (SELECT jsonb_agg(notification_to_json(r) ORDER BY r.created_at DESC)
       FROM (SELECT * FROM page_rows LIMIT GREATEST(p_limit, 0)) r), '[]'::jsonb),
    'hasMore', (SELECT count(*) FROM page_rows) > GREATEST(p_limit, 0)
  );
$$;

-- Hộp thư in-app (mới nhất). Trả jsonb array.
CREATE OR REPLACE FUNCTION notification_inbox(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(notification_to_json(n) ORDER BY n.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM notifications WHERE kind = 'inapp'
    ORDER BY created_at DESC LIMIT GREATEST(p_limit, 0)
  ) n;
$$;

-- Số in-app chưa đọc.
CREATE OR REPLACE FUNCTION notification_unread_count()
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM notifications WHERE kind = 'inapp' AND read_at IS NULL;
$$;

-- Đánh dấu 1 in-app đã đọc.
CREATE OR REPLACE FUNCTION notification_mark_read(p_id text)
RETURNS void
LANGUAGE sql AS $$
  UPDATE notifications SET read_at = now() WHERE id = p_id AND read_at IS NULL;
$$;

-- Đánh dấu tất cả in-app đã đọc. Trả số dòng.
CREATE OR REPLACE FUNCTION notification_mark_all_read()
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE notifications SET read_at = now() WHERE kind = 'inapp' AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Lấy payload (để gửi lại 1 thông báo Zalo failed).
CREATE OR REPLACE FUNCTION notification_payload(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT payload FROM notifications WHERE id = p_id;
$$;

-- Cập nhật trạng thái (sau khi gửi lại).
CREATE OR REPLACE FUNCTION notification_set_status(p_id text, p_status text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql AS $$
  UPDATE notifications
  SET status = COALESCE(NULLIF(p_status,''), status),
      error = NULLIF(p_error, '')
  WHERE id = p_id;
$$;
