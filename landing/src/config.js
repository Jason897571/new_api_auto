// Where the "进入控制台" buttons point. In dev the internal console runs on
// Vite :5173; override at build time with VITE_CONSOLE_URL (e.g. /app in prod).
export const CONSOLE_URL =
  import.meta.env.VITE_CONSOLE_URL || 'http://localhost:5173'
