# JS/web stages are arch-independent; build them on the builder host.
# The final stage stays on the target arch for native addons (e.g. @node-rs/argon2).
FROM --platform=$BUILDPLATFORM node:26-alpine AS web
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/mobile ./apps/mobile
# Empty means the browser calls /api on the same host.
ARG EXPO_PUBLIC_API_URL=
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN pnpm install --frozen-lockfile --filter @rolodex/mobile... \
  && pnpm --filter @rolodex/mobile export

FROM --platform=$BUILDPLATFORM node:26-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY plugin-sdk ./plugin-sdk
COPY apps/api ./apps/api
COPY apps/carddav ./apps/carddav
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY scripts/docker-bundle.mjs ./scripts/docker-bundle.mjs
# Full install so root esbuild (docker-bundle) is available; mobile sources are not needed here.
RUN pnpm install --frozen-lockfile --filter @rolodex/api... --filter @rolodex/carddav... --filter rolodex \
  && node scripts/docker-bundle.mjs

FROM node:26-alpine
RUN apk add --no-cache nginx postgresql-client ca-certificates openssl \
  && apk upgrade --no-cache \
  && mkdir -p /usr/share/nginx/html \
  && rm -f /etc/nginx/http.d/default.conf
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
# Hoist filtered runtime deps so bundled entrypoints can resolve packages from /app/node_modules.
RUN printf '\nshamefully-hoist=true\n' >> .npmrc
COPY packages/db/package.json ./packages/db/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY plugin-sdk/package.json ./plugin-sdk/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/carddav/package.json ./apps/carddav/package.json
# Workspace packages must exist for pnpm; runtime uses bundled JS, not these sources.
RUN mkdir -p packages/db/src packages/core/src plugin-sdk/src apps/api/src apps/carddav/src \
  && printf 'export {}\n' > packages/db/src/index.ts \
  && printf 'export {}\n' > packages/core/src/index.ts \
  && printf 'export {}\n' > plugin-sdk/src/index.ts \
  && printf 'export {}\n' > apps/api/src/main.ts \
  && printf 'export {}\n' > apps/carddav/src/main.ts
RUN pnpm install --frozen-lockfile --prod --filter @rolodex/api... --filter @rolodex/carddav... \
  && rm -rf /root/.cache /tmp/*
COPY packages/db/drizzle ./packages/db/drizzle
COPY plugins ./plugins
COPY registry ./registry
COPY scripts/docker-app.mjs ./scripts/docker-app.mjs
COPY nginx/rolodex.conf /etc/nginx/http.d/default.conf
COPY nginx/rolodex-proxy.inc /etc/nginx/rolodex-proxy.inc
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/carddav/dist ./apps/carddav/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=web /app/apps/mobile/dist /usr/share/nginx/html
ENV NODE_ENV=production
ENV DATA_DIR=/data
CMD ["node", "scripts/docker-app.mjs"]
