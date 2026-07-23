#!/usr/bin/env bash
# 一键启动（开发模式）：后端 :8787 + 前端 Vite :5173（热重载）
# 用法：./start.sh    停止：Ctrl-C（前后端一起关）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=8787
FRONTEND_PORT=5173
FRONTEND_URL="http://localhost:${FRONTEND_PORT}/"

# ---- 依赖检查 ----
need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ 缺少依赖：$1，请先安装。"; exit 1; }; }
need go
need node
need npm

# ---- 端口占用检查 ----
port_busy() { lsof -ti "tcp:$1" >/dev/null 2>&1; }
for p in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if port_busy "$p"; then
    echo "✗ 端口 $p 已被占用，请先释放（lsof -ti tcp:$p 查看，kill 结束）。"
    exit 1
  fi
done

# ---- 前端依赖 ----
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "▸ 首次运行，安装前端依赖…"
  (cd "$ROOT/frontend" && npm install)
fi

# ---- 退出时清理 ----
# 直接按端口杀掉实际监听者，绕过 go run / npm 的孙进程逃逸问题。
# 启动前已确认两个端口空闲，故此时占用它们的进程都是本脚本拉起的。
cleanup() {
  trap - INT TERM EXIT
  echo; echo "▸ 正在停止…"
  pkill -P $$ 2>/dev/null || true  # 先收直接子进程（go run / npm）
  for p in "$BACKEND_PORT" "$FRONTEND_PORT"; do
    pids=$(lsof -ti "tcp:$p" 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
}
trap cleanup INT TERM EXIT

echo "▸ 启动后端  http://localhost:${BACKEND_PORT}"
( cd "$ROOT/backend" && go run . -addr ":${BACKEND_PORT}" -static ../frontend/dist -db ./data/app.db ) &

echo "▸ 启动前端  ${FRONTEND_URL}"
( cd "$ROOT/frontend" && npm run dev ) &

# ---- 等前端就绪后自动开浏览器 ----
open_browser() {
  for _ in $(seq 1 30); do
    if port_busy "$FRONTEND_PORT"; then
      sleep 1
      if command -v open >/dev/null 2>&1; then open "$FRONTEND_URL"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$FRONTEND_URL"
      fi
      return
    fi
    sleep 1
  done
}
open_browser &

echo "▸ 就绪。浏览器访问 ${FRONTEND_URL}  —  按 Ctrl-C 停止。"
wait
