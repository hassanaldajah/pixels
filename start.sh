#!/usr/bin/env bash
# Starts Pixels on macOS / Linux.
#   ./start.sh            build the web app if needed, start the backend, open the browser
#   ./start.sh --dev      backend + Vite dev server with hot reload (http://localhost:5173)
#   ./start.sh --lan      also allow other devices on your network (prints an access token)
#   ./start.sh --rebuild  rebuild the web app first
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port=8765
dev=0; lan=0; rebuild=0
for arg in "$@"; do
  case "$arg" in
    --dev) dev=1 ;;
    --lan) lan=1 ;;
    --rebuild) rebuild=1 ;;
    --port=*) port="${arg#--port=}" ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 was not found. $2" >&2; exit 1; }; }
need uv "Install it from https://docs.astral.sh/uv/"
need pnpm "Install it with: npm install -g pnpm (needs Node.js 22+)"

echo "Installing dependencies..."
(cd "$root/server" && uv sync --frozen)
(cd "$root" && pnpm install --frozen-lockfile)

server_args=(run python -m app --port "$port")
[ "$lan" = 1 ] && server_args+=(--lan)
[ "$dev" = 1 ] && server_args+=(--dev)

open_url() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$1" || true; fi
}

if [ "$dev" = 1 ]; then
  export PIXELS_BACKEND="http://127.0.0.1:$port"
  (cd "$root/server" && uv "${server_args[@]}") &
  backend=$!
  trap 'kill $backend 2>/dev/null || true' EXIT
  (sleep 3; open_url "http://localhost:5173") &
  (cd "$root/apps/web" && pnpm run dev)
  exit 0
fi

if [ "$rebuild" = 1 ] || [ ! -f "$root/apps/web/dist/index.html" ]; then
  echo "Building the web app..."
  (cd "$root/apps/web" && pnpm run build)
fi
(sleep 2; open_url "http://127.0.0.1:$port") &
cd "$root/server" && exec uv "${server_args[@]}"
