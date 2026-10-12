#!/usr/bin/env bash
# Source this file; never changes the caller's/default Kubernetes context.
K=(kubectl --kubeconfig "$HOME/.kube/usos-local/config" --context usos-local)
check_target() {
  "${K[@]}" config view --minify -o json | python3 -c '
import json,sys
c=json.load(sys.stdin)
assert c["current-context"]=="usos-local"
assert c["contexts"][0]["context"]["cluster"]=="usos-local"
assert c["clusters"][0]["cluster"]["server"]=="https://192.168.49.2:8443"
print("Target: local Minikube usos-local; namespaces usos-app / usos-login")'
  "${K[@]}" auth whoami -o json | python3 -c '
import json,sys
assert json.load(sys.stdin)["status"]["userInfo"]["username"]=="minikube-user"
print("Identity: minikube-user")'
}
