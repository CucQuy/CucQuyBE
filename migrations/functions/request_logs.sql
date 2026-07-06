-- ============================================================
-- Domain: request_logs — nhật ký request. Toàn bộ logic ở DB, BE chỉ gọi.
-- Bảng public.request_logs (cột geo là jsonb).
-- ============================================================

-- Ghi 1 log. Tự sinh id, timestamp = now(), expire_at = now() + p_retention_days ngày.
-- p_entry: jsonb {method,path,query,statusCode,durationMs,responseSize,ip,geo,
--                 uid,email,role,userAgent,referer,body}
-- Trả về dòng vừa ghi. KHÔNG throw cho input thiếu — chỉ chèn những gì có.
CREATE OR REPLACE FUNCTION request_log_insert(
  p_entry jsonb,
  p_retention_days int DEFAULT 30
)
RETURNS SETOF request_logs
LANGUAGE plpgsql AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  INSERT INTO request_logs (
    id, method, path, query, status_code, duration_ms, response_size,
    ip, geo, uid, email, role, user_agent, referer, body, timestamp, expire_at
  )
  VALUES (
    gen_random_uuid()::text,
    p_entry->>'method',
    p_entry->>'path',
    p_entry->>'query',
    NULLIF(p_entry->>'statusCode','')::int,
    NULLIF(p_entry->>'durationMs','')::int,
    NULLIF(p_entry->>'responseSize','')::int,
    p_entry->>'ip',
    CASE WHEN p_entry->'geo' IS NULL OR jsonb_typeof(p_entry->'geo') = 'null'
         THEN NULL ELSE p_entry->'geo' END,
    NULLIF(p_entry->>'uid',''),
    NULLIF(p_entry->>'email',''),
    NULLIF(p_entry->>'role',''),
    p_entry->>'userAgent',
    NULLIF(p_entry->>'referer',''),
    NULLIF(p_entry->>'body',''),
    v_now,
    v_now + make_interval(days => GREATEST(p_retention_days, 0))
  )
  RETURNING *;
END;
$$;

-- Danh sách log có lọc + phân trang (offset). orderBy timestamp desc.
-- Lấy dư 1 dòng (limit+1) để BE biết còn trang sau không (hasMore).
-- p_status NULL = không lọc theo status. p_method tự upper.
CREATE OR REPLACE FUNCTION request_log_list(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status int DEFAULT NULL,
  p_uid text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_limit int DEFAULT 50
)
RETURNS SETOF request_logs
LANGUAGE sql STABLE AS $$
  SELECT *
  FROM request_logs
  WHERE (p_from IS NULL OR timestamp >= p_from)
    AND (p_to IS NULL OR timestamp <= p_to)
    AND (p_method IS NULL OR method = upper(p_method))
    AND (p_status IS NULL OR status_code = p_status)
    AND (p_uid IS NULL OR uid = p_uid)
    AND (p_email IS NULL OR email = p_email)
    AND (p_ip IS NULL OR ip = p_ip)
  ORDER BY timestamp DESC
  OFFSET (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_limit, 1), 200)
  LIMIT LEAST(GREATEST(p_limit, 1), 200) + 1;
$$;

-- Thống kê nhanh trên cửa sổ gần nhất (tối đa p_cap dòng mới nhất trong khoảng lọc).
-- p_errors_only = true → chỉ tính trên request lỗi (status >= 400).
-- Trả 1 dòng jsonb rộng: KPI + percentiles latency + bandwidth + phân bố
-- status/method/thiết bị/trình duyệt/OS + top path/ip/quốc gia/referrer/user + endpoint chậm.
CREATE OR REPLACE FUNCTION request_log_stats(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_cap int DEFAULT 2000,
  p_errors_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH scan AS (
    SELECT
      COALESCE(NULLIF(ip,''), 'unknown') AS ip,
      COALESCE(NULLIF(path,''), 'unknown') AS path,
      COALESCE(status_code, 0) AS status_code,
      COALESCE(NULLIF(method,''), '?') AS method,
      COALESCE(duration_ms, 0) AS duration_ms,
      COALESCE(response_size, 0) AS response_size,
      geo->>'country' AS country,
      NULLIF(referer, '') AS referer,
      uid,
      email,
      lower(COALESCE(user_agent, '')) AS ua
    FROM request_logs
    WHERE (p_from IS NULL OR timestamp >= p_from)
      AND (p_to IS NULL OR timestamp <= p_to)
      AND (NOT p_errors_only OR COALESCE(status_code, 0) >= 400)
    ORDER BY timestamp DESC
    LIMIT GREATEST(p_cap, 0)
  ),
  -- Phân loại từ user-agent (thô nhưng đủ dùng).
  ua AS (
    SELECT *,
      CASE
        WHEN ua ~ '(bot|crawl|spider|slurp|bing|headless|monitor)' THEN 'Bot'
        WHEN ua ~ '(mobile|android|iphone|ipad)' THEN 'Mobile'
        WHEN ua = '' THEN 'Khác'
        ELSE 'Desktop'
      END AS device,
      CASE
        WHEN ua LIKE '%edg%' THEN 'Edge'
        WHEN ua ~ '(opr|opera)' THEN 'Opera'
        WHEN ua ~ '(chrome|crios)' THEN 'Chrome'
        WHEN ua ~ '(firefox|fxios)' THEN 'Firefox'
        WHEN ua LIKE '%safari%' THEN 'Safari'
        WHEN ua = '' THEN 'Khác'
        ELSE 'Khác'
      END AS browser,
      CASE
        WHEN ua LIKE '%windows%' THEN 'Windows'
        WHEN ua LIKE '%android%' THEN 'Android'
        WHEN ua ~ '(iphone|ipad|ios)' THEN 'iOS'
        WHEN ua ~ '(mac os|macintosh)' THEN 'macOS'
        WHEN ua LIKE '%linux%' THEN 'Linux'
        WHEN ua = '' THEN 'Khác'
        ELSE 'Khác'
      END AS os
    FROM scan
  ),
  paths AS (
    SELECT jsonb_agg(jsonb_build_object('path', path, 'count', c) ORDER BY c DESC) AS top
    FROM (SELECT path, count(*) AS c FROM scan GROUP BY path ORDER BY c DESC LIMIT 10) p
  ),
  slow AS (
    SELECT jsonb_agg(jsonb_build_object('path', path, 'p95', p95, 'count', c) ORDER BY p95 DESC) AS top
    FROM (
      SELECT path,
             round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95,
             count(*) AS c
      FROM scan GROUP BY path HAVING count(*) >= 3 ORDER BY p95 DESC LIMIT 10
    ) s
  ),
  ips AS (
    SELECT jsonb_agg(jsonb_build_object('ip', ip, 'country', country, 'count', c) ORDER BY c DESC) AS top
    FROM (
      SELECT ip, (array_agg(country))[1] AS country, count(*) AS c
      FROM scan GROUP BY ip ORDER BY c DESC LIMIT 10
    ) i
  ),
  countries AS (
    SELECT jsonb_agg(jsonb_build_object('country', country, 'count', c) ORDER BY c DESC) AS top
    FROM (
      SELECT COALESCE(NULLIF(country,''), '?') AS country, count(*) AS c
      FROM scan GROUP BY 1 ORDER BY c DESC LIMIT 10
    ) x
  ),
  referers AS (
    SELECT jsonb_agg(jsonb_build_object('referer', referer, 'count', c) ORDER BY c DESC) AS top
    FROM (
      SELECT referer, count(*) AS c FROM scan WHERE referer IS NOT NULL
      GROUP BY referer ORDER BY c DESC LIMIT 10
    ) r
  ),
  users AS (
    SELECT jsonb_agg(jsonb_build_object('user', u, 'count', c) ORDER BY c DESC) AS top
    FROM (
      SELECT COALESCE(NULLIF(email,''), uid) AS u, count(*) AS c
      FROM scan WHERE uid IS NOT NULL AND uid <> '' GROUP BY 1 ORDER BY c DESC LIMIT 10
    ) u
  ),
  methods AS (
    SELECT jsonb_agg(jsonb_build_object('method', method, 'count', c) ORDER BY c DESC) AS top
    FROM (SELECT method, count(*) AS c FROM scan GROUP BY method ORDER BY c DESC) x
  ),
  devices AS (
    SELECT jsonb_agg(jsonb_build_object('name', device, 'count', c) ORDER BY c DESC) AS top
    FROM (SELECT device, count(*) AS c FROM ua GROUP BY device ORDER BY c DESC) x
  ),
  browsers AS (
    SELECT jsonb_agg(jsonb_build_object('name', browser, 'count', c) ORDER BY c DESC) AS top
    FROM (SELECT browser, count(*) AS c FROM ua GROUP BY browser ORDER BY c DESC) x
  ),
  oses AS (
    SELECT jsonb_agg(jsonb_build_object('name', os, 'count', c) ORDER BY c DESC) AS top
    FROM (SELECT os, count(*) AS c FROM ua GROUP BY os ORDER BY c DESC) x
  )
  SELECT jsonb_build_object(
    'scanned', (SELECT count(*) FROM scan),
    'total', (SELECT count(*) FROM scan),
    'errorCount', (SELECT count(*) FROM scan WHERE status_code >= 400),
    'uniqueIps', (SELECT count(DISTINCT ip) FROM scan),
    'uniqueUsers', (SELECT count(DISTINCT uid) FROM scan WHERE uid IS NOT NULL AND uid <> ''),
    'bandwidth', (SELECT COALESCE(sum(response_size), 0)::bigint FROM scan),
    'avgDuration', (SELECT COALESCE(round(avg(duration_ms))::int, 0) FROM scan),
    'p50', (SELECT COALESCE(round(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms))::int, 0) FROM scan),
    'p90', (SELECT COALESCE(round(percentile_cont(0.90) WITHIN GROUP (ORDER BY duration_ms))::int, 0) FROM scan),
    'p95', (SELECT COALESCE(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int, 0) FROM scan),
    'p99', (SELECT COALESCE(round(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms))::int, 0) FROM scan),
    'statusBuckets', jsonb_build_object(
      's2xx', (SELECT count(*) FROM scan WHERE status_code BETWEEN 200 AND 299),
      's3xx', (SELECT count(*) FROM scan WHERE status_code BETWEEN 300 AND 399),
      's4xx', (SELECT count(*) FROM scan WHERE status_code BETWEEN 400 AND 499),
      's5xx', (SELECT count(*) FROM scan WHERE status_code >= 500)
    ),
    'methodBuckets', COALESCE((SELECT top FROM methods), '[]'::jsonb),
    'deviceBuckets', COALESCE((SELECT top FROM devices), '[]'::jsonb),
    'browserBuckets', COALESCE((SELECT top FROM browsers), '[]'::jsonb),
    'osBuckets', COALESCE((SELECT top FROM oses), '[]'::jsonb),
    'topCountries', COALESCE((SELECT top FROM countries), '[]'::jsonb),
    'topReferers', COALESCE((SELECT top FROM referers), '[]'::jsonb),
    'topUsers', COALESCE((SELECT top FROM users), '[]'::jsonb),
    'topPaths', COALESCE((SELECT top FROM paths), '[]'::jsonb),
    'slowestPaths', COALESCE((SELECT top FROM slow), '[]'::jsonb),
    'topIps', COALESCE((SELECT top FROM ips), '[]'::jsonb)
  );
$$;

-- Chuỗi thời gian lưu lượng: gom theo 'hour' hoặc 'day' trong khoảng lọc.
-- p_errors_only = true → chỉ tính request lỗi. Trả jsonb array [{ts,requests,errors,uniqueIps}].
CREATE OR REPLACE FUNCTION request_log_timeseries(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_bucket text DEFAULT 'day',
  p_errors_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH b AS (
    SELECT
      date_trunc(CASE WHEN p_bucket = 'hour' THEN 'hour' ELSE 'day' END, timestamp) AS ts,
      COALESCE(status_code, 0) AS status_code,
      COALESCE(NULLIF(ip,''), 'unknown') AS ip
    FROM request_logs
    WHERE (p_from IS NULL OR timestamp >= p_from)
      AND (p_to IS NULL OR timestamp <= p_to)
      AND (NOT p_errors_only OR COALESCE(status_code, 0) >= 400)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ts', ts,
    'requests', c,
    'errors', errc,
    'uniqueIps', uips
  ) ORDER BY ts), '[]'::jsonb)
  FROM (
    SELECT
      ts,
      count(*) AS c,
      count(*) FILTER (WHERE status_code >= 400) AS errc,
      count(DISTINCT ip) AS uips
    FROM b GROUP BY ts
  ) g;
$$;

-- Gom lỗi (status >= 400) theo (method, path, status) — kiểu Sentry.
-- Trả jsonb array [{method,path,status,count,firstSeen,lastSeen}] sắp theo count giảm.
CREATE OR REPLACE FUNCTION request_log_error_groups(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method', method,
    'path', path,
    'status', status_code,
    'count', c,
    'firstSeen', first_seen,
    'lastSeen', last_seen
  ) ORDER BY c DESC), '[]'::jsonb)
  FROM (
    SELECT
      COALESCE(NULLIF(method,''), '?') AS method,
      COALESCE(NULLIF(path,''), 'unknown') AS path,
      COALESCE(status_code, 0) AS status_code,
      count(*) AS c,
      min(timestamp) AS first_seen,
      max(timestamp) AS last_seen
    FROM request_logs
    WHERE COALESCE(status_code, 0) >= 400
      AND (p_from IS NULL OR timestamp >= p_from)
      AND (p_to IS NULL OR timestamp <= p_to)
    GROUP BY 1, 2, 3
    ORDER BY c DESC
    LIMIT GREATEST(p_limit, 0)
  ) g;
$$;

-- Xoá log đã hết hạn (expire_at <= now()). TTL thủ công thay cho Firestore TTL.
-- Trả số dòng đã xoá.
CREATE OR REPLACE FUNCTION request_log_purge_expired()
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
BEGIN
  DELETE FROM request_logs WHERE expire_at IS NOT NULL AND expire_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
