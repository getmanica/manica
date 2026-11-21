# Manica

Bun + Turborepo monorepo: the plane in TypeScript, the agent in Rust.

- `apps/*`: applications.
- `packages/tsconfig`: shared TS configs (`@manica/tsconfig/base.json`, `bun.json`, `react.json`).

## Commands

Toolchains (Bun, Node, Rust, and zig + cargo-zigbuild for the agent's Linux builds) come from `mise.toml`, pinned in `mise.lock`: `mise install`. Bump them there and refresh the lock (`mise lock --platform linux-x64,linux-arm64,macos-arm64`); CI installs from it too (`jdx/mise-action`).

Run from the repo root (Bun only, no npm/pnpm):

- `bun run dev`: start everything
- `bun run check-types`, `bun run lint`, `bun run format:check`
- `bun run test`: plane tests (Vitest) run against a throwaway database on the Postgres from `DATABASE_URL` (see `apps/plane/test/global-setup.ts`); agent tests are `cargo test`
- `bun run --cwd apps/plane db:migrate`: apply the plane's migrations (`db:generate` makes them)

## Conventions

- Each workspace has a `biome.json` extending the root (`"root": false, "extends": "//"`) and a `tsconfig.json` extending `@manica/tsconfig/*` (for the agent, they cover its scripts only).
- Shared dependency versions (`typescript`, `@types/bun`, `@types/node`) come from the root catalog: use `"catalog:"`.
- Commits follow Conventional Commits (enforced by commitlint via lefthook).

## Collaboration

- when working on a new feature if a later commit in the branch is a fix for that feature it becomes a fixup; the feature that ships should not ship with a fix in the same pr


## Plane

- organized in services and controllers
- use typed errors
- runs on Node, not Bun: a TanStack Start app (SSR, file-based routes), built by Vite and bundled whole into `dist/` (`serve.js`, the process; `migrate.js`; `server/`, `client/`). No Bun APIs (`Bun.*`, `bun:*`) in the plane; Bun is only its package manager
- the database is Postgres (postgres.js), from the root `compose.yaml` (`docker compose up -d`; set `POSTGRES_PORT` if 5432 is taken); `DATABASE_URL` is required. The plane never migrates on its own: `src/migrate.ts` does, as a separate step, and the server refuses to start while any migration is pending
- `apps/plane/src` is split in `api/` (the backend), `web/` (the console), `shared/` (dependency-free code both bundle, imported from the web as `@shared/*`), and `routes/` (the file-based routes: pages, from `web/features`, and the server routes `api/$`, `mcp` and `.well-known/$` handing requests to the Elysia app); `server.ts` is Start's server entry (migration check, `scheduled.ts`), `serve.ts` the production process, `types.ts` the package export the agent app uses
- `api/` is layered, lowest first; a module only imports from its own layer or below, never from a feature above it:
  - `platform/`: `env`, `crypto`, the `scheduler`, `pinned-fetch` (SSRF-safe fetch for URLs strangers pick, e.g. MCP client metadata documents), and `db/` (schema split per feature under `db/schema/`, which owns the enums and their constants)
  - `forges/`: the `Forge` port, its registry, and the adapters (`github/`); no feature code
  - features, each with its controllers, services, `errors.ts`, and tests: `organizations/`, `auth/` (better-auth, the session and agent-token macros, and `principal.ts`: who a request acts as and `can(principal, permissions)`), `agents/`, `runners/` (including `agent.controller.ts`, the API the agent binary calls), `jobs/`, `forge-apps/` (registering apps on a forge and receiving their webhooks)
  - `mcp/`: the MCP server, on top of the features: its tools (`tools/*`) call their services, never their controllers, acting as a principal from the token and the organization picked at consent (`mcpGrant`); `errors.ts` is the one place typed errors become tool errors. Nothing imports it but `app.ts`
  - `app.ts` mounts the controllers grouped by audience (console, agents, forges, MCP clients); `errors.ts` holds the cross-cutting HTTP errors
- `web/`: per-feature code under `features/<feature>/`, shared chrome under `components/`, shadcn under `components/ui`. It renders on the server too: no `window`/`document` at module level or while rendering (only in effects and handlers). It reaches the backend through the API (`lib/api`, in-process while rendering on the server) or a server function whose handler imports from `api/` (`lib/session`)
- import named modules directly; no barrel files (`api/runners/index.ts` is the one wiring point, building the services from the forge registry)

## Agent

- Rust (`apps/agent`, crate `manica-agent`), a library (`src/lib.rs`) and its binary (`src/main.rs`); the workspace's `package.json` scripts run cargo, so `bun run build|test|lint|format` cover it, and it holds the version release-please bumps (`build.rs` embeds it; `Cargo.toml`'s stays `0.0.0`)
- the plane's API types come from `apps/plane/openapi/agent.json`, generated at build time (`build.rs`, typify) into `crate::api`; the plane's `agent-api.test.ts` keeps the spec in sync with its routes (`bun run test -u`), so an API change that no longer fits fails the agent's build
- strict lints, as in Cargo.toml's `[lints]`: every clippy group (pedantic, nursery, cargo) plus a curated set of restriction ones (no `unwrap`/`expect`/indexing/`as`/printing outside tests), `-D warnings`, run by `bun run lint` and the pre-commit hook. Fix what they flag rather than allowing it; an `#[allow]` needs a `reason`
- modules as `foo.rs` + `foo/`, never `foo/mod.rs`; errors are typed (`thiserror`), per layer (`errors.rs`, `runner/errors.rs`, `vm/errors.rs`)
- output goes through `lines` (`info`, `error`, `Log`); locks through `lines::lock`
- unix only (process groups, flock); released for darwin and linux (static musl) on arm64 and x64 (`scripts/platforms.ts`), cross-compiled by `scripts/compile.ts`, and published to npm as before (`scripts/npm.ts`)

