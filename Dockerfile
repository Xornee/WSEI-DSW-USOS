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

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
# One local app container, independent Chromium contexts; no Kubernetes or Docker socket.
WORKDIR /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/login-pilot/dashboard-dist/ ./login-pilot/dashboard-dist/
COPY --from=pilot-deps /app/login-pilot/node_modules/ ./login-pilot/node_modules/
COPY shared/ ./shared/
COPY server/usos/ ./server/usos/
COPY login-pilot/*.mjs login-pilot/package.json ./login-pilot/
COPY login-pilot/public/ ./login-pilot/public/
ENV NODE_ENV=production HOME=/tmp PLAYWRIGHT_BROWSERS_PATH=/ms-playwright TZ=Europe/Warsaw
RUN install -d -m 0700 -o 1000 -g 1000 /data/accounts
USER 1000:1000
EXPOSE 8789
WORKDIR /app/login-pilot
CMD ["node", "server.mjs"]
