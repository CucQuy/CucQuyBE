import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TiktokProc } from './tiktok.proc';
import type { TiktokAccount, TiktokTokens } from './tiktok.types';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com';

/** Chưa nối tài khoản → FE hiện nút "Nối TikTok" thay vì báo lỗi đỏ. */
export const TIKTOK_NOT_CONNECTED = 'TIKTOK_NOT_CONNECTED';
/** Token thiếu scope cho việc đang làm → FE nhắc nối lại + submit app review. */
export const TIKTOK_MISSING_SCOPE = 'TIKTOK_MISSING_SCOPE';

/** Hồ sơ cho màn "Kết nối" (Display API). */
const USER_FIELDS = [
  'open_id',
  'union_id',
  'avatar_url',
  'display_name',
  'username',
  'profile_deep_link',
  'is_verified',
  'follower_count',
  'following_count',
  'likes_count',
  'video_count',
].join(',');

/** Metadata video cho màn "Video" (Display API). */
const VIDEO_FIELDS = [
  'id',
  'title',
  'video_description',
  'cover_image_url',
  'share_url',
  'embed_link',
  'duration',
  'create_time',
  'view_count',
  'like_count',
  'comment_count',
  'share_count',
].join(',');

/** Refresh sớm 5 phút — tránh token chết ngay giữa lúc đang gọi API. */
const REFRESH_SKEW_MS = 5 * 60_000;

/**
 * TikTok cho "Kết nối đa kênh".
 *
 * Khác hẳn Facebook/Instagram (token dán sẵn trong env): TikTok chỉ cấp token qua OAuth,
 * access sống 24h và **refresh token ĐỔI sau mỗi lần refresh** → token phải nằm trong DB
 * (`tiktok_account`), env chỉ giữ client key/secret.
 *
 * Quyền phụ thuộc app đã được TikTok duyệt tới đâu:
 * - `user.info.basic/profile/stats` — hồ sơ, dùng được ngay với app mới.
 * - `video.list` — danh sách video (Display API).
 * - `video.upload` / `video.publish` — đăng video (Content Posting API), xem tiktok-publish.service.
 */
@Injectable()
export class TiktokService {
  private readonly logger = new Logger(TiktokService.name);

  constructor(private readonly proc: TiktokProc) {}

  // ── Cấu hình ─────────────────────────────────────────────
  private cfg() {
    return {
      clientKey: String(process.env.TIKTOK_CLIENT_KEY ?? '').trim(),
      clientSecret: String(process.env.TIKTOK_CLIENT_SECRET ?? '').trim(),
      /** Phải trùng TUYỆT ĐỐI với Redirect URI khai trong TikTok Developer Portal. */
      redirectUri: String(process.env.TIKTOK_REDIRECT_URI ?? '').trim(),
      /** Nơi đá người dùng về sau khi nối xong (màn Cài đặt TikTok của admin FE). */
      returnUrl: String(process.env.TIKTOK_RETURN_URL ?? '').trim(),
      scopes: String(
        process.env.TIKTOK_SCOPES ??
          'user.info.basic,user.info.profile,user.info.stats,video.list,video.upload',
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  configured(): boolean {
    const { clientKey, clientSecret, redirectUri } = this.cfg();
    return Boolean(clientKey && clientSecret && redirectUri);
  }

  /** Địa chỉ FE quay về sau OAuth; thiếu env thì về gốc để không redirect vào chỗ trống. */
  returnUrl(query: string): string {
    const base = this.cfg().returnUrl || '/';
    return `${base}${base.includes('?') ? '&' : '?'}${query}`;
  }

  // ── OAuth ────────────────────────────────────────────────
  /**
   * `state` chống CSRF mà KHÔNG cần lưu server-side: ghép email người bấm + nonce + thời
   * điểm rồi ký HMAC bằng client secret. Callback chỉ cần kiểm chữ ký + hạn 10 phút.
   * Nhét email vào đây vì callback là endpoint PUBLIC — không có phiên đăng nhập để hỏi.
   */
  private signState(email: string): string {
    const raw = `${Buffer.from(email).toString('base64url')}.${randomBytes(8).toString('hex')}.${Date.now()}`;
    const sig = createHmac('sha256', this.cfg().clientSecret).update(raw).digest('hex');
    return `${raw}.${sig}`;
  }

  /** null = state giả/hết hạn; chuỗi = email người đã bấm "Nối TikTok" (có thể rỗng). */
  private verifyState(state: string): string | null {
    const parts = String(state ?? '').split('.');
    if (parts.length !== 4) return null;
    const [who, nonce, ts, sig] = parts;
    const expect = createHmac('sha256', this.cfg().clientSecret)
      .update(`${who}.${nonce}.${ts}`)
      .digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Date.now() - Number(ts) >= 10 * 60_000) return null;
    return Buffer.from(who, 'base64url').toString('utf8');
  }

  /** URL để FE chuyển hướng người dùng sang TikTok cấp quyền. */
  authorizeUrl(email = ''): string {
    const { clientKey, redirectUri, scopes } = this.cfg();
    if (!this.configured()) throw new BadRequestException('TIKTOK_NOT_CONFIGURED');
    const q = new URLSearchParams({
      client_key: clientKey,
      scope: scopes.join(','),
      response_type: 'code',
      redirect_uri: redirectUri,
      state: this.signState(email),
    });
    return `${AUTH_URL}?${q.toString()}`;
  }

  /** Gọi endpoint OAuth (form-urlencoded, KHÔNG phải JSON như phần còn lại của API). */
  private async oauth(path: string, form: Record<string, string>): Promise<Record<string, any>> {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    // OAuth trả lỗi ở field `error`/`error_description` (khác API thường: `error.code`).
    if (body?.error && body.error !== 'ok') {
      throw new BadRequestException(String(body.error_description ?? body.error));
    }
    return body;
  }

  private expiryIso(seconds: unknown): string | null {
    const s = Number(seconds);
    return Number.isFinite(s) && s > 0 ? new Date(Date.now() + s * 1000).toISOString() : null;
  }

  /**
   * Đổi `code` từ callback lấy token rồi lưu + kéo luôn hồ sơ.
   * Hồ sơ lấy ngay ở đây để màn Cài đặt có tên/avatar mà không cần bấm thêm.
   */
  async connect(code: string, state: string): Promise<TiktokAccount | null> {
    const email = this.verifyState(state);
    if (email === null) throw new BadRequestException('TIKTOK_BAD_STATE');
    const { clientKey, clientSecret, redirectUri } = this.cfg();
    const t = await this.oauth('/v2/oauth/token/', {
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    await this.proc.saveAccount({
      openId: String(t.open_id ?? ''),
      accessToken: String(t.access_token ?? ''),
      refreshToken: String(t.refresh_token ?? ''),
      scopes: String(t.scope ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      expiresAt: this.expiryIso(t.expires_in),
      refreshExpiresAt: this.expiryIso(t.refresh_expires_in),
      connectedBy: email,
    });

    // Hồ sơ hỏng không được làm hỏng cả lần nối — token đã lưu, bấm "Làm mới" là có.
    try {
      return await this.syncProfile();
    } catch (e) {
      this.logger.warn(`Nối TikTok xong nhưng chưa lấy được hồ sơ: ${String(e)}`);
      return this.proc.account();
    }
  }

  /** Huỷ token phía TikTok rồi xoá khỏi DB. Revoke lỗi vẫn xoá — không giữ token chết. */
  async disconnect(): Promise<{ disconnected: boolean }> {
    const tokens = await this.proc.tokens();
    if (tokens?.accessToken) {
      const { clientKey, clientSecret } = this.cfg();
      await this.oauth('/v2/oauth/revoke/', {
        client_key: clientKey,
        client_secret: clientSecret,
        token: tokens.accessToken,
      }).catch((e) => this.logger.warn(`Revoke TikTok lỗi (vẫn xoá local): ${String(e)}`));
    }
    await this.proc.deleteAccount();
    return { disconnected: true };
  }

  // ── Token ────────────────────────────────────────────────
  /** Access token còn sống; sắp hết hạn thì tự refresh và ghi lại token mới. */
  async accessToken(): Promise<string> {
    const tokens = await this.proc.tokens();
    if (!tokens?.accessToken) throw new BadRequestException(TIKTOK_NOT_CONNECTED);

    const expMs = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : 0;
    if (expMs && expMs - Date.now() > REFRESH_SKEW_MS) return tokens.accessToken;

    const { clientKey, clientSecret } = this.cfg();
    const t = await this.oauth('/v2/oauth/token/', {
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    const next = String(t.access_token ?? '');
    if (!next) throw new BadRequestException(TIKTOK_NOT_CONNECTED);

    await this.proc.saveAccount({
      openId: String(t.open_id ?? tokens.openId),
      accessToken: next,
      // TikTok cấp refresh token MỚI mỗi lần refresh — không ghi lại là lần sau mất quyền.
      refreshToken: String(t.refresh_token ?? tokens.refreshToken),
      expiresAt: this.expiryIso(t.expires_in),
      refreshExpiresAt: this.expiryIso(t.refresh_expires_in),
    });
    return next;
  }

  /** Scope mà token hiện tại thực sự có (app chưa duyệt thì TikTok cấp thiếu). */
  async scopes(): Promise<string[]> {
    const tokens = await this.proc.tokens();
    return Array.isArray(tokens?.scopes) ? tokens.scopes : [];
  }

  async requireScope(scope: string): Promise<void> {
    const list = await this.scopes();
    if (!list.includes(scope)) throw new BadRequestException(`${TIKTOK_MISSING_SCOPE}:${scope}`);
  }

  // ── Gọi API ──────────────────────────────────────────────
  /** Mọi endpoint ngoài OAuth đều là JSON + Bearer token. */
  async api(
    path: string,
    init?: { method?: string; body?: Record<string, unknown> },
  ): Promise<Record<string, any>> {
    const token = await this.accessToken();
    const res = await fetch(`${API}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    const err = body?.error;
    // TikTok luôn trả field `error`, thành công thì code = 'ok'.
    if (err && err.code && err.code !== 'ok') {
      const code = String(err.code);
      if (/scope/i.test(code)) throw new BadRequestException(`${TIKTOK_MISSING_SCOPE}:${code}`);
      throw new BadRequestException(String(err.message || code));
    }
    return body;
  }

  // ── Hồ sơ ────────────────────────────────────────────────
  /** null = chưa nối tài khoản. */
  account(): Promise<TiktokAccount | null> {
    return this.proc.account();
  }

  /** Kéo lại hồ sơ từ TikTok (follower/like/số video đổi liên tục). */
  async syncProfile(): Promise<TiktokAccount | null> {
    const r = await this.api(`/v2/user/info/?fields=${USER_FIELDS}`);
    const u = (r?.data?.user ?? {}) as Record<string, any>;
    return this.proc.saveAccount({
      openId: String(u.open_id ?? ''),
      unionId: String(u.union_id ?? ''),
      displayName: String(u.display_name ?? ''),
      username: String(u.username ?? ''),
      avatarUrl: String(u.avatar_url ?? ''),
      profileUrl: String(u.profile_deep_link ?? ''),
      isVerified: u.is_verified === true,
      followerCount: Number(u.follower_count ?? 0),
      followingCount: Number(u.following_count ?? 0),
      likesCount: Number(u.likes_count ?? 0),
      videoCount: Number(u.video_count ?? 0),
      syncedAt: new Date().toISOString(),
    });
  }

  // ── Video ────────────────────────────────────────────────
  listVideos(limit = 30, offset = 0) {
    return this.proc.listVideos(Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }

  /**
   * Kéo video mới nhất về cache. TikTok phân trang bằng `cursor` (mốc thời gian ms)
   * và tối đa 20 video/lần → lặp tới khi đủ `max` hoặc hết bài.
   */
  async syncVideos(max = 40): Promise<{ synced: number }> {
    await this.requireScope('video.list');
    let cursor: number | undefined;
    let synced = 0;

    while (synced < max) {
      const body: Record<string, unknown> = { max_count: Math.min(20, max - synced) };
      if (cursor) body.cursor = cursor;
      const r = await this.api(`/v2/video/list/?fields=${VIDEO_FIELDS}`, { method: 'POST', body });
      const rows = Array.isArray(r?.data?.videos) ? (r.data.videos as Record<string, any>[]) : [];
      if (rows.length === 0) break;

      for (const v of rows) {
        await this.proc.upsertVideo(this.mapVideo(v));
        synced += 1;
      }
      if (r?.data?.has_more !== true) break;
      cursor = Number(r?.data?.cursor) || undefined;
      if (!cursor) break;
    }

    this.logger.log(`Đồng bộ ${synced} video TikTok`);
    return { synced };
  }

  /** create_time là Unix giây (không phải ms) — nhân 1000 trước khi dựng Date. */
  private mapVideo(v: Record<string, any>): Record<string, unknown> {
    const created = Number(v.create_time);
    return {
      id: String(v.id ?? ''),
      title: String(v.title ?? ''),
      description: String(v.video_description ?? ''),
      coverUrl: String(v.cover_image_url ?? ''),
      shareUrl: String(v.share_url ?? ''),
      embedLink: String(v.embed_link ?? ''),
      duration: Number(v.duration ?? 0),
      viewCount: Number(v.view_count ?? 0),
      likeCount: Number(v.like_count ?? 0),
      commentCount: Number(v.comment_count ?? 0),
      shareCount: Number(v.share_count ?? 0),
      createdTime:
        Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : null,
    };
  }

  /** Token hiện có + app đã cấu hình chưa — cho thẻ trạng thái ở màn Cài đặt. */
  async status(): Promise<Record<string, unknown>> {
    const account = await this.proc.account();
    const tokens: TiktokTokens | null = account ? await this.proc.tokens() : null;
    const scopes = tokens?.scopes ?? [];
    return {
      configured: this.configured(),
      account,
      can: {
        profile: scopes.includes('user.info.basic'),
        stats: scopes.includes('user.info.stats'),
        videoList: scopes.includes('video.list'),
        upload: scopes.includes('video.upload'),
        publish: scopes.includes('video.publish'),
      },
    };
  }
}
