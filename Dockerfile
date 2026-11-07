# syntax=docker/dockerfile:1
#
# The RecipeBox server image, for Azure Container Apps (docs/architecture.md, "Overview" and "Decisions"). One image serves both:
#
#   API (default command):        node --enable-source-maps dist/main.js
#     The Fastify API, listening on PORT (default 3000).
#   Daily trash cleanup (job):    node --enable-source-maps dist/cleanup.js
#     The Container Apps Job overrides the command with this (docs/architecture.md, "Trash cleanup"). It runs once and exits
#     non-zero if any step failed.
#
# Both run in deployed mode: APP_ENV is deliberately not set here, so every setting is required and the app refuses to start
# without them (packages/server/src/config.ts). Settings come from the container app or job, never from the image; Cosmos DB
# and Blob Storage are reached with the managed identity, so there are no keys to pass (docs/architecture.md, "Access to Cosmos
# DB and Blob Storage"). The client is not in this image; it is deployed to Static Web Apps.
#
# Build from the repository root, since the server bundles the workspace packages domain and shared:
#   docker build -t recipebox-server .

ARG NODE_IMAGE=node:22-bookworm-slim

# Build: install the server's workspace with dev dependencies, typecheck and bundle it to plain JavaScript
# (packages/server/build.mjs).
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --workspace @recipebox/server --include-workspace-root
COPY packages/domain/ packages/domain/
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN npm run build -w @recipebox/server

# Production dependencies only: the server's npm packages, which the bundle leaves external. Debian (glibc) rather than Alpine,
# so sharp uses its prebuilt linux-x64 glibc binary (docs/architecture.md, "Photos").
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# The workspace packages are inlined in the bundle; their links would point at sources the image doesn't contain. npm also
# installs sharp's musl and WebAssembly builds (the lockfile can't tell it this is glibc); only the glibc one is ever loaded.
RUN npm ci --omit=dev --workspace @recipebox/server \
  && rm -rf node_modules/@recipebox node_modules/@img/sharp-*musl* node_modules/@img/sharp-wasm32 node_modules/@emnapi \
  && npm cache clean --force

# Runtime: Node, the production dependencies and the bundle. Files stay owned by root, so the app can't change its own code.
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules/
COPY --from=build /app/packages/server/dist/app dist/
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
