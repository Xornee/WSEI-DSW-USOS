#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
source "$HERE/local-target.sh"
check_target
# Reconnect after Recreate rollouts: port-forward is pod-bound internally.
trap 'exit 0' INT TERM
while true; do
  "${K[@]}" -n usos-app port-forward --address=127.0.0.1 service/usos-app 8789:8789 || true
  sleep 2
done
