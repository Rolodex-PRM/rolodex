FROM node:22-bookworm-slim AS web
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/mobile ./apps/mobile
# Empty means the browser calls /api on the same host.
ARG EXPO_PUBLIC_API_URL=
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN pnpm install --frozen-lockfile --filter @rolodex/mobile... \
  && pnpm --filter @rolodex/mobile export

FROM node:22-bookworm-slim
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d \
  && apt-get update \
  && apt-get install -y --no-install-recommends nginx postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY plugin-sdk ./plugin-sdk
COPY apps/api ./apps/api
COPY apps/carddav ./apps/carddav
COPY plugins ./plugins
RUN pnpm install --frozen-lockfile
COPY scripts/docker-app.mjs ./scripts/docker-app.mjs
COPY nginx/rolodex.conf /etc/nginx/conf.d/default.conf
COPY nginx/rolodex-proxy.inc /etc/nginx/rolodex-proxy.inc
COPY --from=web /app/apps/mobile/dist /usr/share/nginx/html
ENV NODE_ENV=production
ENV DATA_DIR=/data
CMD ["node", "scripts/docker-app.mjs"]
