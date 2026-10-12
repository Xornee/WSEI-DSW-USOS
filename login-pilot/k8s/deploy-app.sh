#!/usr/bin/env bash
# Existing local cluster only. Image names are read from the checked-in release manifest.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
source "$HERE/local-target.sh"
check_target
cd "$HERE/../.."
APP_IMAGE=$(sed -n 's/^          image: //p' "$HERE/app.yaml")
WORKER_IMAGE=$(sed -n 's/.*name: USOS_WORKER_IMAGE, value: "\([^"]*\)".*/\1/p' "$HERE/app.yaml")
[[ "$APP_IMAGE" =~ ^usos-app:[a-zA-Z0-9_.-]+$ && "$WORKER_IMAGE" =~ ^usos-chromium:[a-zA-Z0-9_.-]+$ ]]
D=(docker --host unix:///var/run/docker.sock)
# Released tags are immutable. Change both manifest tags before a new build.
for IMAGE in "$APP_IMAGE" "$WORKER_IMAGE"; do
  if "${D[@]}" image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Using existing release image $IMAGE (not rebuilding it)"
  elif [[ "$IMAGE" == "$APP_IMAGE" ]]; then
    "${D[@]}" build -f login-pilot/k8s/App.Dockerfile -t "$IMAGE" .
  else
    "${D[@]}" build -f login-pilot/k8s/Dockerfile -t "$IMAGE" login-pilot
  fi
  bash "$HERE/load-image.sh" "$IMAGE"
done
"${K[@]}" apply --dry-run=server -f "$HERE/app.yaml"
check_target
"${K[@]}" apply -f "$HERE/app.yaml"
"${K[@]}" -n usos-app rollout status deployment/usos-app --timeout=180s
EXPECTED=$("${D[@]}" exec usos-local docker image inspect "$APP_IMAGE" --format '{{.Id}}')
ACTUAL=$("${K[@]}" -n usos-app get pods -l app=usos-app -o jsonpath='{.items[0].status.containerStatuses[0].imageID}')
[[ "${ACTUAL#docker://}" == "$EXPECTED" ]] || { echo 'Running image does not match release' >&2; exit 1; }
"${K[@]}" -n usos-app get deployment,pods,pvc,service
printf 'LIVE IMAGE VERIFIED: %s %s\n' "$APP_IMAGE" "$EXPECTED"
