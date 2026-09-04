-- ============================================================
-- Domain: facebook — bình luận fanpage + cấu hình tự động (086)
-- ============================================================

-- Lưu/ cập nhật 1 bình luận. Idempotent theo id (webhook có thể gửi lại cùng comment).
-- KHÔNG ghi đè cờ đã xử lý (is_hidden/replied_at) bằng giá trị mặc định.
CREATE OR REPLACE FUNCTION facebook_comment_upsert(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := btrim(COALESCE(p_data->>'id',''));
BEGIN
  IF v_id = '' THEN RETURN NULL; END IF;

  INSERT INTO facebook_comments (
    id, post_id, parent_id, psid, from_name, message, is_hidden, created_time, raw, platform
  ) VALUES (
    v_id,
    NULLIF(p_data->>'postId',''),
    NULLIF(p_data->>'parentId',''),
    NULLIF(p_data->>'psid',''),
    NULLIF(p_data->>'fromName',''),
    p_data->>'message',
    COALESCE((p_data->>'isHidden')::boolean, false),
    COALESCE((p_data->>'createdTime')::timestamptz, now()),
    p_data->'raw',
    CASE WHEN p_data->>'platform' = 'instagram' THEN 'instagram' ELSE 'facebook' END
  )
  ON CONFLICT (id) DO UPDATE SET
    message      = COALESCE(EXCLUDED.message, facebook_comments.message),
    from_name    = COALESCE(NULLIF(EXCLUDED.from_name,''), facebook_comments.from_name),
    post_id      = COALESCE(EXCLUDED.post_id, facebook_comments.post_id),
    is_hidden    = CASE WHEN p_data ? 'isHidden' THEN EXCLUDED.is_hidden ELSE facebook_comments.is_hidden END,
    raw          = COALESCE(EXCLUDED.raw, facebook_comments.raw);

  RETURN to_jsonb(c) FROM facebook_comments c WHERE c.id = v_id;
END;
$$;

-- Cache bài đăng (để nhóm bình luận + hiện tiêu đề bài).
CREATE OR REPLACE FUNCTION facebook_post_upsert(p_data jsonb)
RETURNS void
LANGUAGE sql AS $$
  INSERT INTO facebook_posts (id, message, permalink, created_time, synced_at, platform, media_url, media_type)
  VALUES (
    p_data->>'id',
    p_data->>'message',
    p_data->>'permalink',
    COALESCE((p_data->>'createdTime')::timestamptz, now()),
    now(),
    CASE WHEN p_data->>'platform' = 'instagram' THEN 'instagram' ELSE 'facebook' END,
    NULLIF(p_data->>'mediaUrl',''),
    NULLIF(p_data->>'mediaType','')
  )
  ON CONFLICT (id) DO UPDATE SET
    message      = COALESCE(EXCLUDED.message, facebook_posts.message),
    permalink    = COALESCE(EXCLUDED.permalink, facebook_posts.permalink),
    created_time = COALESCE(EXCLUDED.created_time, facebook_posts.created_time),
    media_url    = COALESCE(EXCLUDED.media_url, facebook_posts.media_url),
    media_type   = COALESCE(EXCLUDED.media_type, facebook_posts.media_type),
    platform     = EXCLUDED.platform,
    synced_at    = now()
  WHERE COALESCE(p_data->>'id','') <> '';
$$;

-- Danh sách bình luận cho FE. p_filter: 'pending' (chưa trả lời, chưa ẩn) | 'hidden' | '' (tất cả).
CREATE OR REPLACE FUNCTION facebook_comment_list(
  p_filter text, p_limit int, p_offset int, p_platform text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH rows AS (
    SELECT c.*, p.message AS post_message, p.permalink AS post_permalink,
           p.media_url AS post_media_url
      FROM facebook_comments c
      LEFT JOIN facebook_posts p ON p.id = c.post_id
     WHERE (COALESCE(p_platform,'') = '' OR c.platform = p_platform)
       AND CASE COALESCE(p_filter,'')
             WHEN 'pending' THEN c.replied_at IS NULL AND c.is_hidden = false
             WHEN 'hidden'  THEN c.is_hidden
             WHEN 'replied' THEN c.replied_at IS NOT NULL
             ELSE true
           END
     ORDER BY c.created_time DESC NULLS LAST
     LIMIT GREATEST(1, COALESCE(p_limit, 50)) OFFSET GREATEST(0, COALESCE(p_offset, 0))
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',            r.id,
        'postId',        r.post_id,
        'postMessage',   COALESCE(r.post_message, ''),
        'postPermalink', COALESCE(r.post_permalink, ''),
        'postMediaUrl',  COALESCE(r.post_media_url, ''),
        'platform',      r.platform,
        'psid',          r.psid,
        'fromName',      COALESCE(r.from_name, ''),
        'message',       COALESCE(r.message, ''),
        'isHidden',      r.is_hidden,
        'repliedAt',     r.replied_at,
        'autoAction',    r.auto_action,
        'createdTime',   r.created_time
      ) ORDER BY r.created_time DESC NULLS LAST) FROM rows r), '[]'::jsonb),
    'counts', (
      SELECT jsonb_build_object(
        'total',   COUNT(*),
        'pending', COUNT(*) FILTER (WHERE replied_at IS NULL AND is_hidden = false),
        'hidden',  COUNT(*) FILTER (WHERE is_hidden),
        'replied', COUNT(*) FILTER (WHERE replied_at IS NOT NULL),
        'facebook', COUNT(*) FILTER (WHERE platform = 'facebook'),
        'instagram', COUNT(*) FILTER (WHERE platform = 'instagram')
      ) FROM facebook_comments
     WHERE COALESCE(p_platform,'') = '' OR platform = p_platform
    )
  );
$$;

-- Đánh dấu sau khi thao tác thành công trên Facebook (ẩn / trả lời / luật tự động).
CREATE OR REPLACE FUNCTION facebook_comment_mark(
  p_id text, p_hidden boolean, p_replied boolean, p_auto text
) RETURNS void
LANGUAGE sql AS $$
  UPDATE facebook_comments SET
    is_hidden   = COALESCE(p_hidden, is_hidden),
    hidden_at   = CASE WHEN p_hidden IS TRUE THEN now()
                       WHEN p_hidden IS FALSE THEN NULL ELSE hidden_at END,
    replied_at  = CASE WHEN p_replied IS TRUE THEN now() ELSE replied_at END,
    auto_action = COALESCE(NULLIF(p_auto,''), auto_action)
  WHERE id = p_id;
$$;

-- Đọc 1 bình luận (service cần `platform` để chọn đúng đường dẫn Graph khi ẩn/trả lời).
CREATE OR REPLACE FUNCTION facebook_comment_get(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',       c.id,
    'postId',   c.post_id,
    'psid',     c.psid,
    'platform', c.platform,
    'message',  COALESCE(c.message, ''),
    'isHidden', c.is_hidden
  ) FROM facebook_comments c WHERE c.id = p_id;
$$;

CREATE OR REPLACE FUNCTION facebook_comment_delete(p_id text)
RETURNS void
LANGUAGE sql AS $$
  DELETE FROM facebook_comments WHERE id = p_id;
$$;

-- Cấu hình tự động hoá.
CREATE OR REPLACE FUNCTION facebook_config_get()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'autoHidePhone',    COALESCE(c.auto_hide_phone, false),
    'autoHideKeywords', COALESCE(to_jsonb(c.auto_hide_keywords), '[]'::jsonb),
    'autoReplyEnabled', COALESCE(c.auto_reply_enabled, false),
    'autoReplyText',    COALESCE(c.auto_reply_text, ''),
    'autoPrivateReply', COALESCE(c.auto_private_reply, false),
    'privateReplyText', COALESCE(c.private_reply_text, '')
  ) FROM facebook_config c WHERE c.id = 'fb';
$$;

CREATE OR REPLACE FUNCTION facebook_config_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO facebook_config (id) VALUES ('fb') ON CONFLICT (id) DO NOTHING;
  UPDATE facebook_config SET
    auto_hide_phone    = CASE WHEN p_data ? 'autoHidePhone'
                              THEN COALESCE((p_data->>'autoHidePhone')::boolean, false)
                              ELSE auto_hide_phone END,
    auto_hide_keywords = CASE WHEN p_data ? 'autoHideKeywords' THEN (
                              SELECT COALESCE(array_agg(btrim(s)), '{}'::text[])
                                FROM jsonb_array_elements_text(
                                  CASE WHEN jsonb_typeof(p_data->'autoHideKeywords') = 'array'
                                       THEN p_data->'autoHideKeywords' ELSE '[]'::jsonb END
                                ) AS s WHERE btrim(s) <> '')
                              ELSE auto_hide_keywords END,
    auto_reply_enabled = CASE WHEN p_data ? 'autoReplyEnabled'
                              THEN COALESCE((p_data->>'autoReplyEnabled')::boolean, false)
                              ELSE auto_reply_enabled END,
    auto_reply_text    = CASE WHEN p_data ? 'autoReplyText' THEN NULLIF(p_data->>'autoReplyText','') ELSE auto_reply_text END,
    auto_private_reply = CASE WHEN p_data ? 'autoPrivateReply'
                              THEN COALESCE((p_data->>'autoPrivateReply')::boolean, false)
                              ELSE auto_private_reply END,
    private_reply_text = CASE WHEN p_data ? 'privateReplyText' THEN NULLIF(p_data->>'privateReplyText','') ELSE private_reply_text END,
    updated_at         = now()
  WHERE id = 'fb';
  RETURN facebook_config_get();
END;
$$;

-- ============================================================
-- Bài đăng mạng xã hội (088) — soạn 1 lần, đăng FB + IG
-- ============================================================
CREATE OR REPLACE FUNCTION social_post_save(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := COALESCE(NULLIF(p_data->>'id',''), gen_random_uuid()::text);
BEGIN
  INSERT INTO social_posts (id, message, image_url, targets, scheduled_at, status, created_by)
  VALUES (
    v_id,
    COALESCE(p_data->>'message',''),
    NULLIF(p_data->>'imageUrl',''),
    COALESCE((
      SELECT array_agg(s) FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_data->'targets') = 'array' THEN p_data->'targets' ELSE '[]'::jsonb END
      ) AS s WHERE s IN ('facebook','instagram')
    ), '{facebook}'::text[]),
    CASE WHEN NULLIF(p_data->>'scheduledAt','') IS NOT NULL
         THEN (p_data->>'scheduledAt')::timestamptz END,
    COALESCE(NULLIF(p_data->>'status',''), 'draft'),
    NULLIF(p_data->>'createdBy','')
  )
  ON CONFLICT (id) DO UPDATE SET
    message      = EXCLUDED.message,
    image_url    = EXCLUDED.image_url,
    targets      = EXCLUDED.targets,
    scheduled_at = EXCLUDED.scheduled_at,
    status       = EXCLUDED.status,
    updated_at   = now();

  RETURN to_jsonb(p) FROM social_posts p WHERE p.id = v_id;
END;
$$;

-- Ghi kết quả sau khi gọi Graph (id bài trên từng kênh, hoặc lỗi).
CREATE OR REPLACE FUNCTION social_post_mark(p_id text, p_status text, p_remote jsonb, p_error text)
RETURNS void
LANGUAGE sql AS $$
  UPDATE social_posts SET
    status       = COALESCE(NULLIF(p_status,''), status),
    remote_ids   = CASE WHEN p_remote IS NULL THEN remote_ids ELSE remote_ids || p_remote END,
    error        = NULLIF(p_error,''),
    published_at = CASE WHEN p_status = 'published' THEN now() ELSE published_at END,
    updated_at   = now()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION social_post_list(p_limit int, p_offset int)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(t.x ORDER BY t.created_at DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id',          p.id,
      'message',     p.message,
      'imageUrl',    COALESCE(p.image_url,''),
      'targets',     to_jsonb(p.targets),
      'scheduledAt', p.scheduled_at,
      'status',      p.status,
      'remoteIds',   p.remote_ids,
      'error',       COALESCE(p.error,''),
      'publishedAt', p.published_at,
      'createdAt',   p.created_at
    ) AS x, p.created_at
      FROM social_posts p
     ORDER BY p.created_at DESC
     LIMIT GREATEST(1, COALESCE(p_limit, 50)) OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;
$$;

-- Bài tới giờ đăng mà worker chưa xử lý.
CREATE OR REPLACE FUNCTION social_post_due()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'message', p.message, 'imageUrl', COALESCE(p.image_url,''),
    'targets', to_jsonb(p.targets)
  )), '[]'::jsonb)
    FROM social_posts p
   WHERE p.status = 'scheduled' AND p.scheduled_at IS NOT NULL AND p.scheduled_at <= now();
$$;

CREATE OR REPLACE FUNCTION social_post_delete(p_id text)
RETURNS void
LANGUAGE sql AS $$
  DELETE FROM social_posts WHERE id = p_id AND status <> 'published';
$$;
