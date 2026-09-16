-- ============================================================
-- Domain: tiktok — tài khoản OAuth + video + đăng video (099)
-- ============================================================

-- ── Tài khoản (single-row) ──────────────────────────────────

-- Hồ sơ cho màn "Kết nối". KHÔNG trả access_token/refresh_token ra ngoài —
-- FE không bao giờ cần token, lộ ra là mất tài khoản.
CREATE OR REPLACE FUNCTION tiktok_account_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'connected',        true,
    'openId',           a.open_id,
    'displayName',      a.display_name,
    'username',         a.username,
    'avatarUrl',        COALESCE(a.avatar_url,''),
    'profileUrl',       COALESCE(a.profile_url,''),
    'isVerified',       a.is_verified,
    'followerCount',    a.follower_count,
    'followingCount',   a.following_count,
    'likesCount',       a.likes_count,
    'videoCount',       a.video_count,
    'scopes',           to_jsonb(a.scopes),
    'expiresAt',        a.expires_at,
    'refreshExpiresAt', a.refresh_expires_at,
    'connectedBy',      COALESCE(a.connected_by,''),
    'syncedAt',         a.synced_at,
    'connectedAt',      a.created_at
  ) FROM tiktok_account a WHERE a.id = 1;
$$;

-- Token của tài khoản — CHỈ service backend gọi (để ký request lên TikTok).
CREATE OR REPLACE FUNCTION tiktok_account_tokens()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'openId',           a.open_id,
    'accessToken',      a.access_token,
    'refreshToken',     a.refresh_token,
    'scopes',           to_jsonb(a.scopes),
    'expiresAt',        a.expires_at,
    'refreshExpiresAt', a.refresh_expires_at
  ) FROM tiktok_account a WHERE a.id = 1;
$$;

-- Ghi token sau khi OAuth xong hoặc sau mỗi lần refresh.
-- Field nào KHÔNG có trong p_data thì giữ nguyên giá trị cũ: lúc refresh TikTok chỉ
-- trả token, không trả hồ sơ — gọi hàm này không được xoá mất tên/avatar đã lưu.
CREATE OR REPLACE FUNCTION tiktok_account_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tiktok_account (id, open_id, access_token, refresh_token)
  VALUES (
    1,
    COALESCE(p_data->>'openId',''),
    COALESCE(p_data->>'accessToken',''),
    COALESCE(p_data->>'refreshToken','')
  )
  ON CONFLICT (id) DO NOTHING;

  UPDATE tiktok_account SET
    open_id            = COALESCE(NULLIF(p_data->>'openId',''), open_id),
    union_id           = CASE WHEN p_data ? 'unionId' THEN NULLIF(p_data->>'unionId','') ELSE union_id END,
    display_name       = CASE WHEN p_data ? 'displayName' THEN COALESCE(p_data->>'displayName','') ELSE display_name END,
    username           = CASE WHEN p_data ? 'username' THEN COALESCE(p_data->>'username','') ELSE username END,
    avatar_url         = CASE WHEN p_data ? 'avatarUrl' THEN NULLIF(p_data->>'avatarUrl','') ELSE avatar_url END,
    profile_url        = CASE WHEN p_data ? 'profileUrl' THEN NULLIF(p_data->>'profileUrl','') ELSE profile_url END,
    is_verified        = CASE WHEN p_data ? 'isVerified' THEN COALESCE((p_data->>'isVerified')::boolean, false) ELSE is_verified END,
    follower_count     = CASE WHEN p_data ? 'followerCount'  THEN COALESCE((p_data->>'followerCount')::bigint, 0)  ELSE follower_count END,
    following_count    = CASE WHEN p_data ? 'followingCount' THEN COALESCE((p_data->>'followingCount')::bigint, 0) ELSE following_count END,
    likes_count        = CASE WHEN p_data ? 'likesCount'     THEN COALESCE((p_data->>'likesCount')::bigint, 0)     ELSE likes_count END,
    video_count        = CASE WHEN p_data ? 'videoCount'     THEN COALESCE((p_data->>'videoCount')::bigint, 0)     ELSE video_count END,
    access_token       = COALESCE(NULLIF(p_data->>'accessToken',''),  access_token),
    refresh_token      = COALESCE(NULLIF(p_data->>'refreshToken',''), refresh_token),
    scopes             = CASE WHEN p_data ? 'scopes' THEN (
                              SELECT COALESCE(array_agg(btrim(s)), '{}'::text[])
                                FROM jsonb_array_elements_text(
                                  CASE WHEN jsonb_typeof(p_data->'scopes') = 'array'
                                       THEN p_data->'scopes' ELSE '[]'::jsonb END
                                ) AS s WHERE btrim(s) <> '')
                              ELSE scopes END,
    expires_at         = CASE WHEN p_data ? 'expiresAt'        THEN NULLIF(p_data->>'expiresAt','')::timestamptz        ELSE expires_at END,
    refresh_expires_at = CASE WHEN p_data ? 'refreshExpiresAt' THEN NULLIF(p_data->>'refreshExpiresAt','')::timestamptz ELSE refresh_expires_at END,
    connected_by       = CASE WHEN p_data ? 'connectedBy' THEN NULLIF(p_data->>'connectedBy','') ELSE connected_by END,
    synced_at          = CASE WHEN p_data ? 'syncedAt' THEN NULLIF(p_data->>'syncedAt','')::timestamptz ELSE synced_at END,
    updated_at         = now()
  WHERE id = 1;

  RETURN tiktok_account_get();
END;
$$;

-- Ngắt kết nối: xoá token + video đã cache (dữ liệu của tài khoản cũ, giữ lại vô nghĩa).
-- Lịch sử đăng (tiktok_publishes) GIỮ để còn tra lại đã đăng gì.
CREATE OR REPLACE FUNCTION tiktok_account_delete()
RETURNS void
LANGUAGE sql AS $$
  DELETE FROM tiktok_videos;
  DELETE FROM tiktok_account WHERE id = 1;
$$;

-- ── Video (Display API) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION tiktok_video_upsert(p_data jsonb)
RETURNS void
LANGUAGE sql AS $$
  INSERT INTO tiktok_videos (
    id, title, description, cover_url, share_url, embed_link, duration,
    view_count, like_count, comment_count, share_count, created_time, synced_at
  ) VALUES (
    p_data->>'id',
    COALESCE(p_data->>'title',''),
    COALESCE(p_data->>'description',''),
    NULLIF(p_data->>'coverUrl',''),
    NULLIF(p_data->>'shareUrl',''),
    NULLIF(p_data->>'embedLink',''),
    COALESCE((p_data->>'duration')::int, 0),
    COALESCE((p_data->>'viewCount')::bigint, 0),
    COALESCE((p_data->>'likeCount')::bigint, 0),
    COALESCE((p_data->>'commentCount')::bigint, 0),
    COALESCE((p_data->>'shareCount')::bigint, 0),
    NULLIF(p_data->>'createdTime','')::timestamptz,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title         = EXCLUDED.title,
    description   = EXCLUDED.description,
    cover_url     = EXCLUDED.cover_url,
    share_url     = EXCLUDED.share_url,
    embed_link    = EXCLUDED.embed_link,
    duration      = EXCLUDED.duration,
    view_count    = EXCLUDED.view_count,
    like_count    = EXCLUDED.like_count,
    comment_count = EXCLUDED.comment_count,
    share_count   = EXCLUDED.share_count,
    created_time  = COALESCE(EXCLUDED.created_time, tiktok_videos.created_time),
    synced_at     = now();
$$;

-- Danh sách video + tổng chỉ số (FE hiện dải thống kê trên đầu màn).
CREATE OR REPLACE FUNCTION tiktok_video_list(p_limit int, p_offset int)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(x ORDER BY ord) FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY v.created_time DESC NULLS LAST, v.id) AS ord,
          jsonb_build_object(
            'id',           v.id,
            'title',        v.title,
            'description',  v.description,
            'coverUrl',     COALESCE(v.cover_url,''),
            'shareUrl',     COALESCE(v.share_url,''),
            'embedLink',    COALESCE(v.embed_link,''),
            'duration',     v.duration,
            'viewCount',    v.view_count,
            'likeCount',    v.like_count,
            'commentCount', v.comment_count,
            'shareCount',   v.share_count,
            'createdTime',  v.created_time
          ) AS x
        FROM tiktok_videos v
        ORDER BY v.created_time DESC NULLS LAST, v.id
        LIMIT p_limit OFFSET p_offset
      ) t
    ), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'videos',   COUNT(*),
        'views',    COALESCE(SUM(view_count), 0),
        'likes',    COALESCE(SUM(like_count), 0),
        'comments', COALESCE(SUM(comment_count), 0),
        'shares',   COALESCE(SUM(share_count), 0),
        'syncedAt', MAX(synced_at)
      ) FROM tiktok_videos
    )
  );
$$;

-- ── Đăng video (Content Posting API) ────────────────────────

CREATE OR REPLACE FUNCTION tiktok_publish_get(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',             p.id,
    'title',          p.title,
    'videoUrl',       p.video_url,
    'mode',           p.mode,
    'privacyLevel',   p.privacy_level,
    'disableComment', p.disable_comment,
    'disableDuet',    p.disable_duet,
    'disableStitch',  p.disable_stitch,
    'scheduledAt',    p.scheduled_at,
    'status',         p.status,
    'publishId',      COALESCE(p.publish_id,''),
    'videoId',        COALESCE(p.video_id,''),
    'error',          COALESCE(p.error,''),
    'createdBy',      COALESCE(p.created_by,''),
    'publishedAt',    p.published_at,
    'createdAt',      p.created_at
  ) FROM tiktok_publishes p WHERE p.id = p_id;
$$;

CREATE OR REPLACE FUNCTION tiktok_publish_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := COALESCE(NULLIF(p_data->>'id',''), gen_random_uuid()::text);
BEGIN
  INSERT INTO tiktok_publishes (
    id, title, video_url, mode, privacy_level,
    disable_comment, disable_duet, disable_stitch, scheduled_at, status, created_by
  ) VALUES (
    v_id,
    COALESCE(p_data->>'title',''),
    COALESCE(p_data->>'videoUrl',''),
    CASE WHEN p_data->>'mode' = 'direct' THEN 'direct' ELSE 'inbox' END,
    COALESCE(NULLIF(p_data->>'privacyLevel',''), 'SELF_ONLY'),
    COALESCE((p_data->>'disableComment')::boolean, false),
    COALESCE((p_data->>'disableDuet')::boolean, false),
    COALESCE((p_data->>'disableStitch')::boolean, false),
    NULLIF(p_data->>'scheduledAt','')::timestamptz,
    COALESCE(NULLIF(p_data->>'status',''), 'draft'),
    NULLIF(p_data->>'createdBy','')
  )
  ON CONFLICT (id) DO UPDATE SET
    title           = EXCLUDED.title,
    video_url       = EXCLUDED.video_url,
    mode            = EXCLUDED.mode,
    privacy_level   = EXCLUDED.privacy_level,
    disable_comment = EXCLUDED.disable_comment,
    disable_duet    = EXCLUDED.disable_duet,
    disable_stitch  = EXCLUDED.disable_stitch,
    scheduled_at    = EXCLUDED.scheduled_at,
    status          = EXCLUDED.status,
    updated_at      = now();

  RETURN tiktok_publish_get(v_id);
END;
$$;

-- Ghi kết quả sau khi gọi TikTok (init trả publish_id, /status/fetch/ trả kết quả cuối).
CREATE OR REPLACE FUNCTION tiktok_publish_mark(
  p_id text,
  p_status text,
  p_publish_id text,
  p_video_id text,
  p_error text
)
RETURNS void
LANGUAGE sql AS $$
  UPDATE tiktok_publishes SET
    status       = COALESCE(NULLIF(p_status,''), status),
    publish_id   = COALESCE(NULLIF(p_publish_id,''), publish_id),
    video_id     = COALESCE(NULLIF(p_video_id,''), video_id),
    error        = NULLIF(p_error,''),
    published_at = CASE WHEN p_status = 'published' THEN now() ELSE published_at END,
    updated_at   = now()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION tiktok_publish_list(p_limit int, p_offset int)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(t.x ORDER BY t.created_at DESC), '[]'::jsonb) FROM (
    SELECT tiktok_publish_get(p.id) AS x, p.created_at
      FROM tiktok_publishes p
     ORDER BY p.created_at DESC
     LIMIT p_limit OFFSET p_offset
  ) t;
$$;

-- Bài tới giờ hẹn — worker mỗi phút quét rồi mới gọi TikTok.
CREATE OR REPLACE FUNCTION tiktok_publish_due()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(tiktok_publish_get(p.id) ORDER BY p.scheduled_at), '[]'::jsonb)
    FROM tiktok_publishes p
   WHERE p.status = 'scheduled' AND p.scheduled_at IS NOT NULL AND p.scheduled_at <= now();
$$;

-- Bài đã init nhưng TikTok còn đang xử lý — worker hỏi lại /status/fetch/.
CREATE OR REPLACE FUNCTION tiktok_publish_pending()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(tiktok_publish_get(p.id) ORDER BY p.updated_at), '[]'::jsonb)
    FROM tiktok_publishes p
   WHERE p.status = 'processing' AND COALESCE(p.publish_id,'') <> '';
$$;

CREATE OR REPLACE FUNCTION tiktok_publish_delete(p_id text)
RETURNS void
LANGUAGE sql AS $$
  DELETE FROM tiktok_publishes WHERE id = p_id;
$$;
