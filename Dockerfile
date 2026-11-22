# syntax=docker/dockerfile:1.7
# Imagens da api e do worker (ADR-0026). Build multi-stage, ARM64 (Fargate Graviton, ADR-0018):
#   docker buildx build --platform linux/arm64 --target api    -t mini-banco/api:<sha> .
#   docker buildx build --platform linux/arm64 --target worker -t mini-banco/worker:<sha> .
# Runtime: só dist/ + dependências de produção, usuário não-root (SEC-35), compatível com
# readonlyRootFilesystem (escrita só em /tmp, volume da task). A imagem da api também roda
# a task de migration (`node apps/api/dist/migrate.js`, com o binário do dbmate).

ARG NODE_IMAGE=node:26.13.0-bookworm-slim
ARG PNPM_VERSION=12.18.0

# ---------- base: Node + pnpm ----------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# O Node 25+ não traz mais o corepack: pnpm instalado na versão exata do packageManager.
RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force
WORKDIR /repo

# ---------- build: instala tudo e compila os pacotes (swc) ----------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/messaging/package.json packages/messaging/
COPY packages/observability/package.json packages/observability/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter "@mini-banco/api..." --filter "@mini-banco/worker..." run build
# Binário do dbmate da mesma versão do lockfile (pacote opcional da plataforma de build).
RUN bin="$(find node_modules/.pnpm -path '*/@dbmate/linux-arm64/bin/dbmate' | head -n 1)" \
    && test -n "$bin" && cp "$bin" /repo/dbmate && /repo/dbmate --version

# ---------- dependências de produção por app ----------
FROM base AS prod-deps
ARG APP
COPY --from=build /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/packages/contracts/package.json packages/contracts/
COPY --from=build /repo/packages/database/package.json packages/database/
COPY --from=build /repo/packages/messaging/package.json packages/messaging/
COPY --from=build /repo/packages/observability/package.json packages/observability/
COPY --from=build /repo/packages/config/package.json packages/config/
COPY --from=build /repo/apps/${APP}/package.json apps/${APP}/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@mini-banco/${APP}..."

# ---------- runtime comum ----------
FROM ${NODE_IMAGE} AS runtime
ARG APP
ENV NODE_ENV=production \
    DB_SSL=verify-full \
    DB_SSL_CA_FILE=/app/certs/rds-global-bundle.pem
WORKDIR /app
COPY --from=prod-deps --chown=root:root /repo/node_modules node_modules
COPY --from=prod-deps --chown=root:root /repo/packages packages
COPY --from=prod-deps --chown=root:root /repo/apps/${APP} apps/${APP}
COPY --from=build --chown=root:root /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=root:root /repo/packages/database/dist packages/database/dist
COPY --from=build --chown=root:root /repo/packages/messaging/dist packages/messaging/dist
COPY --from=build --chown=root:root /repo/packages/observability/dist packages/observability/dist
COPY --from=build --chown=root:root /repo/apps/${APP}/dist apps/${APP}/dist
# CA bundle do RDS versionado no repo (SEC-20): build reprodutível, sem download sem checksum.
COPY --chown=root:root infra/certs/rds-global-bundle.pem certs/rds-global-bundle.pem
# Arquivos do root, processo como `node` (uid 1000): o app não consegue reescrever o próprio código.
USER node
WORKDIR /app/apps/${APP}
STOPSIGNAL SIGTERM

# ---------- api (+ migration) ----------
FROM runtime AS api
COPY --from=build --chown=root:root /repo/db/migrations /app/db/migrations
COPY --from=build --chown=root:root /repo/dbmate /app/bin/dbmate
ENV PORT=3001 DBMATE_BIN=/app/bin/dbmate MIGRATIONS_DIR=/app/db/migrations
EXPOSE 3001
# --max-old-space-size vem da task definition (NODE_OPTIONS, PERF-21), calculado pela memória.
CMD ["node", "--enable-source-maps", "--import", "@mini-banco/observability/register", "dist/main.js"]

# ---------- worker ----------
FROM runtime AS worker
EXPOSE 3002
CMD ["node", "--enable-source-maps", "--import", "@mini-banco/observability/register", "dist/main.js"]
