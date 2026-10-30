# Manica

Bun + Turborepo monorepo.

- `apps/*`: applications.
- `packages/tsconfig`: shared TS configs (`@manica/tsconfig/base.json`, `bun.json`, `react.json`).

## Commands

Run from the repo root (Bun only, no npm/pnpm):

- `bun run dev`: start everything
- `bun run check-types`, `bun run lint`, `bun run format:check`

## Conventions

- Each workspace has a `biome.json` extending the root (`"root": false, "extends": "//"`) and a `tsconfig.json` extending `@manica/tsconfig/*`.
- Shared dependency versions (`typescript`, `@types/bun`, `@types/node`) come from the root catalog: use `"catalog:"`.
- Commits follow Conventional Commits (enforced by commitlint via lefthook).

## Collaboration

- when working on a new feature if a later commit in the branch is a fix for that feature it becomes a fixup; the feature that ships should not ship with a fix in the same pr
