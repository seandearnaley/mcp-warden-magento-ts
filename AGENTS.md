# Repository Guidelines

## Project Structure & Module Organization

- `src/`: TypeScript source.
  - `index.ts`: MCP server bootstrap (stdio transport, arg parsing).
  - `tools/`: Tool handlers (e.g., `magento.ts`, `warden.ts`).
  - `lib/`: Utilities (`exec.ts`, `env.ts`, `logger.ts`).
- `tests/`: Automated tests.
  - `unit/`: Vitest specs (`*.test.ts`).
  - `e2e/`: Playwright specs.
  - `fixtures/`: Helper files for tests.
- `dist/`: Compiled JS output (via `pnpm run build`).
- `coverage/`: Coverage reports (`vitest --coverage`).

## Build, Test, and Development Commands

- `pnpm install`: Install dependencies.
- `pnpm run build`: Compile TypeScript to `dist/`.
- `pnpm run dev -- --warden-root <path>`: Run with `tsx` for local dev (not for MCP clients).
- `pnpm start -- --warden-root <path>`: Run built server (`node dist/index.js`).
- `pnpm run test`: Run all unit tests (Vitest).
- `pnpm run test:unit`: Unit tests with coverage.
- `pnpm run test:e2e`: Playwright E2E tests.
- `pnpm run lint` / `pnpm run lint:fix`: ESLint check/fix.
- `pnpm run format` / `format:check`: Prettier write/check.
- `pnpm run check`: Lint + format check.

## Coding Style & Naming Conventions

- Language: TypeScript, `strict` mode; NodeNext modules.
- Formatting: Prettier 3; 2‑space indent, single quotes, semicolons per Prettier.
- Linting: ESLint 9 + `@typescript-eslint` + `eslint-plugin-prettier`.
- Files: lowercase descriptive names (`src/tools/magento.ts`, `src/lib/logger.ts`).
- Exports: prefer named exports; avoid `any`; handle promises explicitly.

## Testing Guidelines

- Frameworks: Vitest (unit) with V8 coverage; Playwright (E2E scaffolding).
- File pattern: `tests/**/*.test.ts`.
- Coverage: no hard threshold; keep critical paths covered. Generate with `pnpm run test:unit` and inspect `coverage/`.
- Add tests for new utilities and tool argument validation; use `tests/fixtures` where helpful.

## Commit & Pull Request Guidelines

- Commits: imperative, concise subject (e.g., "Add Magento cache tools"). Group related changes; keep noise out.
- PRs: include summary, rationale, and test results. Link issues when applicable. For tool changes, include example invocations (e.g., `magento.cacheClean {"types":["config"]}`).
- CI/readiness: ensure `pnpm run check` and `pnpm run test` pass; build succeeds.

## Security & Configuration Tips

- Tools run inside Warden containers; never shell out unvalidated input. Follow existing Zod schemas.
- Use built server (`node dist/index.js`) for MCP clients; `dev` prints logs that can break stdio.
- Be cautious with destructive tools (e.g., `warden.redisFlushAll`).
