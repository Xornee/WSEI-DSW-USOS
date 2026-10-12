# Build from the repository root. Dockerfile-specific allowlist excludes all private data.
FROM node:24.21.0-trixie-slim@sha256:db3ae80f5d8df06e04dabdf7b44cbf008d32de168205fa0294444aabbc08c590 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY web/ ./web/
COPY shared/ ./shared/
COPY login-pilot/build-dashboard.mjs ./login-pilot/build-dashboard.mjs
RUN node login-pilot/build-dashboard.mjs && npm prune --omit=dev --no-audit --no-fund

FROM node:24.21.0-trixie-slim@sha256:db3ae80f5d8df06e04dabdf7b44cbf008d32de168205fa0294444aabbc08c590 AS pilot-deps
WORKDIR /app/login-pilot
COPY login-pilot/package.json login-pilot/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Rebuild upstream kubectl source with the patched Go toolchain. The official
# v1.35.8 binary still embeds Go 1.26.5; source and toolchain are pinned below.
FROM golang:1.26.8-trixie@sha256:771f3162219f7a66bb6be3fea1ba31f418932946a99ad9eac26ffd555dfcf393 AS kubectl
RUN curl -fsSL https://codeload.github.com/kubernetes/kubernetes/tar.gz/refs/tags/v1.35.8 -o /src.tar.gz \
 && echo '9c5405c149f11f9ede2398038d9706dce3693a8867725690cf65902733c48190  /src.tar.gz' | sha256sum -c - \
 && mkdir /src && tar -xzf /src.tar.gz -C /src --strip-components=1
WORKDIR /src
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} GOTOOLCHAIN=local go build -p 4 -mod=vendor -trimpath \
 -ldflags='-s -w -X k8s.io/component-base/version.gitVersion=v1.35.8+usos.go1.26.8 -X k8s.io/component-base/version.gitMajor=1 -X k8s.io/component-base/version.gitMinor=35' \
 -o /kubectl ./cmd/kubectl

# Only runtime libraries, Node and kubectl; no shell, apt, npm or unused OS tools.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:54df941ed0d06a1bd95ef5e0ce391fd8d9f94b64782dc9a60062727849ee3f97
WORKDIR /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=kubectl /kubectl /usr/local/bin/kubectl
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/login-pilot/dashboard-dist/ ./login-pilot/dashboard-dist/
COPY --from=pilot-deps /app/login-pilot/node_modules/ ./login-pilot/node_modules/
COPY shared/ ./shared/
COPY server/usos/ ./server/usos/
COPY login-pilot/*.mjs login-pilot/package.json ./login-pilot/
COPY login-pilot/public/ ./login-pilot/public/
COPY login-pilot/k8s/incluster.json ./login-pilot/k8s/incluster.json
ENV NODE_ENV=production HOME=/tmp PLAYWRIGHT_BROWSERS_PATH=/tmp/pw
USER 1000:1000
EXPOSE 8789
WORKDIR /app/login-pilot
CMD ["node", "server.mjs"]
