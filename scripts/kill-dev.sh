#!/bin/sh
# Stops whatever is listening on the dev server port (default 1420, see vite.config.ts).
# Usage: scripts/kill-dev.sh [port]
set -eu

port="${1:-1420}"
pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)

if [ -z "$pids" ]; then
  echo "port $port is free"
  exit 0
fi

for pid in $pids; do
  echo "killing $pid: $(ps -o command= -p "$pid")"
done
kill $pids

# Give processes a moment to exit, then force-kill any that remain.
for _ in 1 2 3 4 5; do
  lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null || { echo "port $port is free"; exit 0; }
  sleep 0.2
done
kill -9 $pids 2>/dev/null || true
echo "port $port is free"
