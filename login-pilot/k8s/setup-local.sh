#!/usr/bin/env bash
# Dedicated local cluster only. Never uses the default kubeconfig/context.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
export KUBECONFIG="$HOME/.kube/usos-local/config"
export DOCKER_HOST=unix:///var/run/docker.sock
export DOCKER_CONTEXT=default
mkdir -p "$(dirname "$KUBECONFIG")"
chmod 700 "$(dirname "$KUBECONFIG")"
minikube start -p usos-local --driver=docker --cpus=4 --memory=8192 --cni=calico --kubernetes-version=v1.35.1 --keep-context
K=(kubectl --kubeconfig "$KUBECONFIG" --context usos-local)
"${K[@]}" config view --minify -o json | python3 -c 'import json,sys; c=json.load(sys.stdin); assert c["contexts"][0]["context"]["cluster"]=="usos-local"; print("Target: usos-local / namespace usos-login")'
"${K[@]}" auth whoami -o json | python3 -c 'import json,sys; assert json.load(sys.stdin)["status"]["userInfo"]["username"]=="minikube-user"'
"${K[@]}" apply --dry-run=client -f k8s/bootstrap.yaml
"${K[@]}" apply -f k8s/bootstrap.yaml
python3 k8s/controller-config.py
# Only the dedicated local minikube node receives this seccomp file.
docker --host unix:///var/run/docker.sock inspect usos-local --format '{{.Name}} {{.Config.Image}}'
docker --host unix:///var/run/docker.sock exec usos-local mkdir -p /var/lib/kubelet/seccomp/usos
docker --host unix:///var/run/docker.sock cp k8s/chromium-seccomp.json usos-local:/var/lib/kubelet/seccomp/usos/chromium.json
if ! docker --host unix:///var/run/docker.sock image inspect usos-chromium:2026-09-14-security-v3 >/dev/null 2>&1; then
  docker --host unix:///var/run/docker.sock build -f k8s/Dockerfile -t usos-chromium:2026-09-14-security-v3 .
fi
bash k8s/load-image.sh usos-chromium:2026-09-14-security-v3
"${K[@]}" wait --for=condition=Ready node/usos-local --timeout=120s
printf 'Ready. Start the app: npm run start:kubernetes\n'
