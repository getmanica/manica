# syntax=docker/dockerfile:1

# Build from the repository root: docker build -f apps/plane/Dockerfile .
#
# The build stage runs on the builder's own platform and cross-compiles for
# the target, and the final stage only copies files, so a multi-platform build
# needs neither emulation nor a runner per architecture.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.4-slim AS build

WORKDIR /app

# Every workspace manifest is needed for the frozen lockfile to resolve; only
# the plane's dependencies get installed.
COPY package.json bun.lock ./
COPY apps/plane/package.json apps/plane/
COPY apps/agent/package.json apps/agent/
COPY packages/tsconfig packages/tsconfig
RUN bun install --frozen-lockfile --ignore-scripts --filter plane

COPY apps/plane apps/plane

# x64 builds target baseline CPUs: self-hosted machines may predate AVX2.
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) target=bun-linux-x64-baseline ;; \
      arm64) target=bun-linux-arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && cd apps/plane \
    && bun run build --target "$target"

FROM gcr.io/distroless/cc-debian13:nonroot

WORKDIR /app
COPY --from=build /app/apps/plane/dist/plane ./plane
COPY --from=build /app/apps/plane/drizzle ./drizzle

ENV NODE_ENV=production \
    PORT=3000 \
    MIGRATIONS_DIR=/app/drizzle

EXPOSE 3000
ENTRYPOINT ["/app/plane"]
