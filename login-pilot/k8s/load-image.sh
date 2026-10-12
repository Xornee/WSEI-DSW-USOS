#!/usr/bin/env bash
# Import an exact archive into the dedicated node; verify config digest, not a mutable tag.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
source "$HERE/local-target.sh"
IMAGE=${1:?Usage: load-image.sh image:unique-tag}
[[ "$IMAGE" =~ ^usos-(app|chromium):[a-zA-Z0-9_.-]+$ ]] || { echo 'Unexpected image name' >&2; exit 1; }
check_target
D=(docker --host unix:///var/run/docker.sock)
"${D[@]}" inspect usos-local --format '{{.Name}} {{.Config.Image}}'
ARCHIVE=$(mktemp --suffix=.tar)
trap 'rm -f "$ARCHIVE"' EXIT
"${D[@]}" image save --platform linux/amd64 -o "$ARCHIVE" "$IMAGE"
EXPECTED=$(python3 - "$ARCHIVE" <<'PY'
import tarfile,json,hashlib,sys
with tarfile.open(sys.argv[1]) as t:
    m=json.load(t.extractfile('manifest.json'))
    assert len(m)==1, 'Expected one platform image'
    data=t.extractfile(m[0]['Config']).read()
    c=json.loads(data)
    assert c['os']=='linux' and c['architecture']=='amd64'
    print('sha256:'+hashlib.sha256(data).hexdigest())
PY
)
CURRENT=$("${D[@]}" exec usos-local docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)
if [[ -n "$CURRENT" && "$CURRENT" != "$EXPECTED" ]]; then
  echo 'This tag already points to different node content. Choose a new release tag.' >&2
  exit 1
fi
check_target
"${D[@]}" exec -i usos-local docker image load < "$ARCHIVE"
ACTUAL=$("${D[@]}" exec usos-local docker image inspect "$IMAGE" --format '{{.Id}}')
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo 'Image digest mismatch' >&2; exit 1; }
printf 'VERIFIED IMAGE %s %s\n' "$IMAGE" "$ACTUAL"
