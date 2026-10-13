#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/infrastructure"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run Zcash regtest (electriccoinco/zcashd)."
  echo "Install Docker, then: ./scripts/zcash-regtest.sh"
  exit 1
fi

mkdir -p zcash-data zcash-params
docker compose up -d

echo "Waiting for zcashd RPC on 127.0.0.1:18232..."
for i in $(seq 1 60); do
  if curl -sS --user veil:veil-regtest \
    --data-binary '{"jsonrpc":"1.0","id":"veil","method":"getblockchaininfo","params":[]}' \
    -H "content-type: text/plain;" \
    http://127.0.0.1:18232/ >/dev/null 2>&1; then
    echo "Zcash regtest is up."
    exit 0
  fi
  sleep 2
done
echo "zcashd did not become ready."
exit 1
