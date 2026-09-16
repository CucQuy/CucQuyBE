/** Hồ sơ tài khoản TikTok đang nối — KHÔNG chứa token (FE không được thấy). */
export interface TiktokAccount {
  connected: boolean;
  openId: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
  scopes: string[];
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  connectedBy: string;
  syncedAt: string | null;
  connectedAt: string | null;
}

/** Token của tài khoản — chỉ dùng trong backend để ký request lên TikTok. */
export interface TiktokTokens {
  openId: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: string | null;
  refreshExpiresAt: string | null;
}

/** 1 video kéo về từ Display API. */
export interface TiktokVideo {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  shareUrl: string;
  embedLink: string;
  duration: number; // giây
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  createdTime: string | null;
}

/** 'direct' = đăng thẳng lên profile; 'inbox' = đẩy vào hộp nháp của app TikTok. */
export type TiktokPublishMode = 'direct' | 'inbox';

export type TiktokPublishStatus =
  | 'draft'
  | 'scheduled'
  | 'processing'
  | 'published'
  | 'failed';

/** Ai xem được video sau khi đăng — TikTok bắt buộc chọn 1 trong các mức này. */
export type TiktokPrivacyLevel =
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY';

/** 1 lần đăng video từ app. */
export interface TiktokPublish {
  id: string;
  title: string;
  videoUrl: string;
  mode: TiktokPublishMode;
  privacyLevel: TiktokPrivacyLevel;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  scheduledAt: string | null;
  status: TiktokPublishStatus;
  publishId: string;
  videoId: string;
  error: string;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string | null;
}
