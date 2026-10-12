FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
# Keep the Playwright browser revision matched to the locked client package.
# GStreamer bad plugins serve WebKit, not this Chromium-only worker.
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
 && apt-get purge -y gstreamer1.0-plugins-bad libgstreamer-plugins-bad1.0-0 \
 && rm -rf /var/lib/apt/lists/* /ms-playwright/firefox-* /ms-playwright/webkit-*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
# npm/corepack/yarn are not needed by the browser service at runtime.
RUN rm -rf /usr/lib/node_modules/npm /usr/lib/node_modules/corepack /usr/lib/node_modules/yarn \
 && rm -f /usr/bin/npm /usr/bin/npx /usr/bin/corepack /usr/bin/yarn /usr/bin/yarnpkg
COPY k8s/chromium-server.mjs ./chromium-server.mjs
USER 1000:1000
ENV HOME=/tmp DEBUG=""
EXPOSE 3000
CMD ["node", "chromium-server.mjs"]
