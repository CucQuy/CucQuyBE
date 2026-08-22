import { Injectable } from '@nestjs/common';
import { NetworkProc, IpStatus, NetworkRange } from './network.proc';

/**
 * Ánh xạ controller (segment API đầu) → các MÀN HÌNH (route FE) dùng nó.
 * Guard chặn 1 controller khi off-network CHỈ KHI *mọi* màn dùng controller đó
 * đều đang bật guard → đảm bảo màn chưa bật guard không bị gãy API.
 * Controller KHÔNG có ở đây → không bao giờ bị guard (auth/config/network/images...).
 */
const CONTROLLER_SCREENS: Record<string, string[]> = {
  orders: ['/orders'],
  'dine-in': ['/dine-in'],
  shipping: ['/shipping'],
  promotions: ['/promotions'],
  transactions: ['/finance/overview', '/finance/ledger', '/finance/reconcile'],
  revenue: ['/finance/overview'],
  products: ['/storage'],
  recipes: ['/recipes'],
  customers: ['/partners/customers'],
  carriers: ['/partners/carriers'],
  'stock-receipts': ['/expenses/receipts', '/expenses/materials', '/partners/suppliers'],
  assets: ['/expenses/assets'],
  'manual-expenses': ['/expenses/opex'],
  employees: ['/employees'],
  shifts: ['/shifts'],
  wages: ['/shifts'],
  attendance: ['/attendance', '/attendance/register', '/attendance/manage'],
  users: ['/users'],
  calendar: ['/calendar'],
};

const GUARD_TTL_MS = 15_000; // cache danh sách màn guard
const IP_TTL_MS = 10_000; // cache trạng thái IP

@Injectable()
export class NetworkService {
  private guardedCache: { at: number; screens: Set<string> } | null = null;
  private ipCache = new Map<string, { at: number; status: IpStatus }>();

  constructor(private readonly proc: NetworkProc) {}

  // ---- config guard theo màn ----
  async guardedScreens(): Promise<string[]> {
    const [row] = await this.proc.guardGet();
    return row?.result ?? [];
  }

  async saveGuardedScreens(routes: string[]): Promise<string[]> {
    const [row] = await this.proc.guardSave(routes);
    this.guardedCache = null; // bust cache
    return row?.result ?? [];
  }

  // ---- danh sách dải mạng ----
  async networks(): Promise<NetworkRange[]> {
    const [row] = await this.proc.networksList();
    return row?.result ?? [];
  }
  async upsertNetwork(input: unknown): Promise<NetworkRange> {
    this.ipCache.clear();
    const [row] = await this.proc.networksUpsert(input);
    return row.result;
  }
  async deleteNetwork(id: string): Promise<void> {
    this.ipCache.clear();
    await this.proc.networksDelete(id);
  }
  async currentIpInfo(ip: string): Promise<{ ip: string; suggestedCidr: string }> {
    const [row] = await this.proc.suggestCidr(ip);
    return { ip, suggestedCidr: row?.result || ip };
  }

  async ipStatus(ip: string): Promise<IpStatus> {
    const cached = this.ipCache.get(ip);
    if (cached && Date.now() - cached.at < IP_TTL_MS) return cached.status;
    try {
      const [row] = await this.proc.ipStatus(ip);
      const status = row?.result ?? { configured: false, allowed: false, ip };
      this.ipCache.set(ip, { at: Date.now(), status });
      return status;
    } catch {
      // FAIL-OPEN: lỗi DB → coi như chưa cấu hình (không chặn) để tránh khoá cả app.
      return { configured: false, allowed: false, ip };
    }
  }

  private async guardedSet(): Promise<Set<string>> {
    if (this.guardedCache && Date.now() - this.guardedCache.at < GUARD_TTL_MS) {
      return this.guardedCache.screens;
    }
    try {
      const screens = new Set(await this.guardedScreens());
      this.guardedCache = { at: Date.now(), screens };
      return screens;
    } catch {
      return new Set(); // FAIL-OPEN: lỗi DB → không guard màn nào.
    }
  }

  /** Tập controller bị guard (mọi màn dùng nó đều bật). Rỗng nếu không có màn nào guard. */
  private async guardedControllers(): Promise<Set<string>> {
    const guarded = await this.guardedSet();
    const out = new Set<string>();
    if (guarded.size === 0) return out;
    for (const [ctrl, screens] of Object.entries(CONTROLLER_SCREENS)) {
      if (screens.length > 0 && screens.every((s) => guarded.has(s))) out.add(ctrl);
    }
    return out;
  }

  /**
   * Request có bị chặn theo mạng không?
   * - controller không thuộc tập guard → cho qua.
   * - chưa cấu hình dải mạng nào (configured=false) → cho qua (an toàn, tránh tự khoá).
   * - IP thuộc dải cho phép → qua; else chặn.
   */
  async isBlocked(controller: string, ip: string): Promise<boolean> {
    const ctrls = await this.guardedControllers();
    if (!ctrls.has(controller)) return false;
    const status = await this.ipStatus(ip);
    if (!status.configured) return false;
    return !status.allowed;
  }
}
