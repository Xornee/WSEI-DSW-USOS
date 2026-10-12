#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
export WORKER_BACKEND=kubernetes
export USOS_KUBECONFIG="${USOS_KUBECONFIG:-$HOME/.kube/usos-local/controller.json}"
export USOS_WORKER_IMAGE="${USOS_WORKER_IMAGE:-usos-chromium:2026-09-14-security-v3}"
exec node server.mjs
