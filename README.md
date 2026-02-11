# Micropolis Monorepo

TypeScript + React + Turborepo scaffold for the Micropolis port.

## Requirements
- Node.js >= 24
- pnpm >= 10.28 (Corepack recommended)

## Getting started
```bash
corepack enable
pnpm install
pnpm dev
```

## Workspace layout
- `apps/web`: Vite + React app using TanStack Router (file-based routes live in `src/routes`)
- `packages`: Ports of the core Micropolis engine, tiles, harness, etc

## Common commands
```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format
```

## Autonomous task orchestration
The repo includes a Codex-driven orchestrator at `scripts/auto-orchestrator.mjs`. I change it for each long-running task, so it just contains whatever made sense for the last iteration.

Inspect queue + drift:
```bash
pnpm auto:queue
pnpm auto:drift
```

Run unattended (default runtime cap: 24 hours):
```bash
pnpm auto:run -- --max-runtime-minutes 1440
```

Useful flags:
- `--once`: complete exactly one task and stop.
- `--dry-run`: plan/selection only; no git push or PR changes.
- `--streams <id,...>`: run only specific stage stream ids (`stage-0` ... `stage-4`).
- `--no-tests`: remove `pnpm test` from `--checks` if present.
- `--max-retries-per-task <n>`: retries before a task is marked blocked.
- `--model <name>`: pass a specific model to `codex exec`.

The orchestrator stores state/logs in `.automation/`.
Create `.automation/STOP` to halt the loop after the current iteration.

## Turborepo remote caching
Remote caching is ready to wire up when you want it:
```bash
pnpm dlx turbo login
pnpm dlx turbo link
```
Then set `TURBO_TOKEN` and `TURBO_TEAM` in CI secrets.
