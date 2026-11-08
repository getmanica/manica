# syntax=docker/dockerfile:1

# Build from the repository root: docker build -f apps/plane/Dockerfile .
#
# The build stage runs on the builder's own platform: what it builds is
# JavaScript with every dependency bundled in, so the final stage only
# copies files, and a multi-platform build needs neither emulation nor a
# runner per architecture.

# Bun installs the dependencies; Node runs the build. Both for the builder's
# platform: copying from the image directly would take the target's Bun.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.4-slim AS bun

FROM --platform=$BUILDPLATFORM node:24-slim AS build

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Every workspace manifest is needed for the frozen lockfile to resolve; only
# the plane's dependencies get installed.
COPY package.json bun.lock ./
COPY apps/plane/package.json apps/plane/
COPY apps/agent/package.json apps/agent/
COPY packages/tsconfig packages/tsconfig
RUN bun install --frozen-lockfile --ignore-scripts --filter plane

COPY apps/plane apps/plane
RUN cd apps/plane && bun run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot

# dist/serve.js is the plane; dist/migrate.js applies the migrations in
# drizzle/, as a step of its own before the plane starts (it refuses to
# start while any are pending):
#   docker run … ghcr.io/getmanica/plane dist/migrate.js
WORKDIR /app
COPY --from=build /app/apps/plane/dist ./dist
COPY --from=build /app/apps/plane/drizzle ./drizzle

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000
CMD ["dist/serve.js"]
