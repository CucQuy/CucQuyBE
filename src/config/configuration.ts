/** Đọc & validate biến môi trường. (Firebase đã gỡ — auth qua SSO RiceService.) */
export interface AppConfig {
  port: number;
  allowedOrigins: string[];
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT) || 3000,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
