# USOS application and Chromium in local Kubernetes

## Deployed architecture (2026-09-14)

- **usos-app namespace:** one non-root Deployment serves the built React frontend, account login, dashboard API and authenticated Chromium viewer. The Service is ClusterIP, port 8789.
- **usos-login namespace:** a short-lived Chromium Job per active login, created by the deployed backend. The two-connection limit is unchanged.
- **accounts PVC (1 GiB):** app accounts/password hashes persist at `/data/accounts/accounts.sqlite`. The live PV uses Retain. USOS cookies, app sessions and browser profiles remain memory-only.
- Frontend and backend share one application image. Chromium uses its separate Playwright image.
- Local URL: **http://127.0.0.1:8789** through `open-app.sh`. Only the kubectl tunnel runs on the workstation for app access.

## Build / deploy / open

Prerequisite: existing dedicated Minikube profile `usos-local`, worker image and seccomp profile installed by `setup-local.sh`.

```sh
cd login-pilot
bash k8s/deploy-app.sh
bash k8s/open-app.sh
```

`App.Dockerfile` builds from the repository root with its adjacent ignore-file allowlist. It builds React/Vite, installs locked runtime dependencies and checksum-verifies kubectl 1.35.1. The Node base is digest-pinned. Private .env/.data/.cache, fixtures, kubeconfigs and browser profiles are excluded. The other Dockerfile still builds Chromium only.

The app uses a projected service-account token. `incluster.json` contains a tokenFile path, never a literal token; kubectl rereads it on rotation. Private worker port-forward now runs inside the app pod through the API server. Worker ingress stays closed; no CDP endpoint is public.

`PILOT_BIND_HOST=0.0.0.0` permits Service traffic while `PILOT_PUBLIC_ORIGIN=http://127.0.0.1:8789` enforces exact Host/Origin. Probe requests include that Host. An HTTPS canonical origin sets Secure cookies. Proxy headers are not trusted. Future ingress needs matching Origin/probe settings and a specific ingress NetworkPolicy rule.

**One replica, Recreate strategy:** SQLite, sessions and connection limits are process-local. Do not scale replicas. The tunnel script reconnects after deployment replacement.

App egress permits DNS, public HTTP(S), and only this Minikube API Service/node endpoint. Browser egress still blocks peers and the API. The app service account receives only the existing worker Role in usos-login, not admin access or secret-read permission.

### Account migration completed

The verified old host process was stopped before a consistent SQLite backup. A temporary non-root pod imported it into the PVC using exclusive file creation. SHA256 equality and SQLite integrity were checked; the importer was removed before app startup.

The private backup remains only at `login-pilot/.data/before-app-kubernetes.sqlite` (0600), outside images/releases. The original host database is unchanged. New registrations now exist on the PVC: do not switch back to a stale host database.

For another first migration: prepare Deployment replicas=0; stop the source; take a consistent private SQLite backup; import through a temporary non-root PVC-mounted pod with exclusive creation; verify hash/integrity; remove importer; deploy replicas=1. Never overwrite an existing PVC DB. A fresh installation without old accounts can deploy directly.

### Optional host development mode

`npm run start:kubernetes` still runs the backend on the host with its dedicated 24-hour controller kubeconfig. It is not needed by the deployed app. Do not start it while the tunnel owns port 8789. Only that optional host credential is renewed by `python3 k8s/controller-config.py`.

All cluster scripts explicitly use `~/.kube/usos-local/config`, context `usos-local` and verify identity/endpoint. The unrelated default context is untouched.

## Lifecycle

1. An authenticated app user clicks **Połącz USOS / Uruchom Chromium** (`POST /api/start` with same-Origin checks).
2. The backend creates a Job and owner-bound Secret with a random browser capability. Kubernetes creates a separate sandboxed Chromium pod. Neither object contains app-account identifiers, Microsoft data, USOS cookies nor a persistent browser profile.
3. A loopback-only `kubectl port-forward` carries Playwright's internal control connection. It uses the per-job random WebSocket path. This endpoint is never sent to the user's browser. Existing owner-authenticated `/viewer` supplies frames/input; users cannot choose pod names or control URLs.
4. The user completes Microsoft and MFA interactively. Existing `BrowserWorker.verify` imports only the exact-host USOS cookie into the backend HTTP jar and checks the same USOS account using a separate backend request.
5. Successful verification closes the remote browser and deletes its Job/pod/Secret. The existing backend jar/cache powers the dashboard; no browser is needed for subsequent data requests. Reconnecting starts a new pod.
6. Logout, expiry, failed startup and orderly shutdown clean their own workers. Cleanup errors retain a retryable lease. Independently of the backend, `activeDeadlineSeconds: 900` ends abandoned Jobs; `ttlSecondsAfterFinished: 30` removes them and garbage-collects Secrets. No cron job or user interaction is needed for orphan timeout cleanup.

The browser deadline is 15 minutes from Job creation; app sessions retain their existing 30-minute lifetime. Two active connection slots remain the app-level limit; connected users still occupy a slot after the browser closes. Namespace quotas are a second hard bound, not a replacement for per-user authorization.

## Container / isolation

- Pinned Playwright 1.63.0 image digest; matching npm version in lockfile. Build context is allowlisted: package manifests and worker entry only, excluding `.data`, `.env`, fixtures and dashboard sources.
- UID/GID 1000, Chromium sandbox enabled, capabilities dropped, no privilege escalation, read-only root filesystem. Browser profile/temp files use per-pod memory-backed `emptyDir`; `/dev/shm` is separate, not host IPC.
- Chromium needs namespace-related syscalls. `chromium-seccomp.json` comes unmodified from Playwright v1.63.0 and is installed only inside the named Minikube node at `/var/lib/kubelet/seccomp/usos/chromium.json`. Pods use this **Localhost seccomp profile**, not privileged mode, `SYS_ADMIN`, or an unconfined profile.
- No host mounts, host networking, shared browser profiles or mounted Kubernetes service-account credentials in browser pods.
- Namespace Pod Security admission is `restricted`. A ResourceQuota bounds Pods/Jobs/Secrets and total requested/limited resources. Each browser requests 250m CPU/512 MiB and is limited to 2 CPUs/1536 MiB, including memory-backed temp files.
- Calico default-denies ingress. Egress permits cluster DNS and public IPv4 HTTP/HTTPS, excluding private, loopback, link-local and carrier-grade NAT ranges. Peer pods and the Kubernetes API are blocked. This is not a hostname-specific university allowlist; an egress proxy/domain policy is a future public-hosting improvement.
- The controller can manage Jobs and create Secrets only in `usos-login`; it can read Pods and open port-forward but cannot read Secrets, exec into Pods or operate in other namespaces. The deployed app uses a projected service-account token; optional host mode uses its own dedicated kubeconfig.

## Validation

```sh
npm test
npm run check
npm run test:kubernetes
# Opt-in: uses temporary accounts and restarts the deployed app; no active logins:
node test/app-kubernetes-live.mjs
```

Ordinary tests do not create Kubernetes resources. The explicitly invoked live suite validates the dedicated cluster, creates two synthetic app accounts, starts two **actual** Chromium pods, verifies cookie/input isolation, rejects a wrong browser capability, checks authenticated viewer frames, tests peer/API network blocking with a localhost positive control, performs a synthetic account handoff, rechecks the backend after pod deletion, and observes Kubernetes independently cleaning an abandoned worker. It uses an in-memory account database and does not alter actual accounts. The synthetic handoff is not proof of a real Microsoft/MFA login.

## Operations / next stage

Read-only local inventory (explicit cluster):

```sh
kubectl --kubeconfig ~/.kube/usos-local/config --context usos-local -n usos-login get jobs,pods,resourcequota
```

Runtime rollback: stop the tunnel and scale the app to zero, then take a consistent private backup of the PVC database before returning to host mode. Preserve new accounts; never overwrite them with the pre-migration snapshot. Rollout undo retains the PVC but clears in-memory sessions. Source rollback is supplied in the release directory and tested on a copy.

Still separate work: public domain/ingress/TLS, shared auth sessions and distributed limits for multiple replicas, PostgreSQL, off-node backups, monitoring, hosting-network Microsoft compatibility and two-real-user acceptance. This is a local Minikube deployment, not an internet endpoint or high availability. Deleting the Minikube profile destroys local storage despite PV Retain.

Sources:
- https://playwright.dev/docs/docker
- https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server
- https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/utils/docker/seccomp_profile.json
- https://minikube.sigs.k8s.io/docs/handbook/network_policy/
- https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/

- https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
- https://kubernetes.io/docs/concepts/storage/persistent-volumes/
