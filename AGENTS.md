# Manica

Bun + Turborepo monorepo.

- `apps/*`: applications.
- `packages/tsconfig`: shared TS configs (`@manica/tsconfig/base.json`, `bun.json`, `react.json`).

## Commands

Run from the repo root (Bun only, no npm/pnpm):

- `bun run dev`: start everything
- `bun run check-types`, `bun run lint`, `bun run format:check`
- `bun run test`: plane tests run against a throwaway database on the Postgres from `DATABASE_URL` (see `apps/plane/test/setup.ts`)

## Conventions

- Each workspace has a `biome.json` extending the root (`"root": false, "extends": "//"`) and a `tsconfig.json` extending `@manica/tsconfig/*`.
- Shared dependency versions (`typescript`, `@types/bun`, `@types/node`) come from the root catalog: use `"catalog:"`.
- Commits follow Conventional Commits (enforced by commitlint via lefthook).

## Collaboration

- when working on a new feature if a later commit in the branch is a fix for that feature it becomes a fixup; the feature that ships should not ship with a fix in the same pr


## Plane

- organized in services and controllers
- use typed errors
- the database is Postgres, from the root `compose.yaml` (`docker compose up -d`; set `POSTGRES_PORT` if 5432 is taken); `DATABASE_URL` is required. Migrations run at startup
- `apps/plane/src` is split in `api/` (the backend), `web/` (the console), and `shared/` (dependency-free code both bundle, imported from the web as `@shared/*`); `main.ts` boots both, `types.ts` is the package export the agent app uses
- `api/` is layered, lowest first; a module only imports from its own layer or below, never from a feature above it:
  - `platform/`: `env`, `crypto`, the `scheduler`, and `db/` (schema split per feature under `db/schema/`, which owns the enums and their constants)
  - `forges/`: the `Forge` port, its registry, and the adapters (`github/`); no feature code
  - features, each with its controllers, services, `errors.ts`, and tests: `organizations/`, `auth/` (session and agent-token macros), `agents/`, `runners/` (including `agent.controller.ts`, the API the agent binary calls), `jobs/`, `forge-apps/` (registering apps on a forge and receiving their webhooks)
  - `app.ts` mounts the controllers grouped by audience (console, agents, forges); `errors.ts` holds the cross-cutting HTTP errors
- `web/`: per-feature code under `features/<feature>/`, shared chrome under `components/`, shadcn under `components/ui`
- import named modules directly; no barrel files (`api/runners/index.ts` is the one wiring point, building the services from the forge registry)
