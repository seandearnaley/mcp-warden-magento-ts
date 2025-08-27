# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

### Essential Commands
- **Build the project**: `pnpm run build` - Compiles TypeScript to `dist/` directory
- **Install dependencies**: `pnpm install` - Install all dependencies
- **Run linting**: `pnpm run lint` - Check code style with ESLint
- **Auto-fix lint issues**: `pnpm run lint:fix` - Fix ESLint issues automatically
- **Format code**: `pnpm run format` - Format with Prettier
- **Check formatting**: `pnpm run format:check` - Check if code needs formatting
- **Full check**: `pnpm run check` - Run both lint and format check

### Testing Commands
- **Run all tests**: `pnpm test` - Execute unit tests with Vitest
- **Unit tests with coverage**: `pnpm run test:unit` - Generate coverage report in `coverage/` directory
- **E2E tests**: `pnpm run test:e2e` - Run Playwright E2E tests (scaffolding in place)
- **Run specific test file**: `pnpm test tests/unit/env.test.ts`

### Development Workflow
- **Development mode**: `pnpm run dev -- --warden-root /path/to/warden/env` - Uses tsx for auto-reload (local terminal only, not for MCP clients)
- **Production mode**: `node dist/index.js --warden-root /path/to/warden/env` - Run built server for MCP Inspector or clients
- **Watch mode**: `pnpm run watch` - Run TypeScript compiler and linter in watch mode concurrently

## Architecture Overview

### Core Structure
This is a Model Context Protocol (MCP) server that provides AI assistants structured access to Magento 2 operations within Warden Docker environments. Each server instance is bound to a specific Warden project directory.

### Module Organization
- **`src/index.ts`**: Entry point - Sets up MCP server with stdio transport, parses CLI arguments, validates Warden project
- **`src/tools/`**: Tool implementations registered with MCP server
  - `magento.ts`: Magento-specific operations (cache, setup, indexing, config management)
  - `warden.ts`: Warden container operations (exec, logs, environment info)
- **`src/lib/`**: Core utilities
  - `exec.ts`: Command execution with timeouts, Warden project validation, redaction of sensitive args
  - `env.ts`: Parse .env files, detect Warden projects, sanitize environment variables
  - `logger.ts`: Winston-based logging with file rotation in production, console in dev

### Key Design Patterns
1. **Project Binding**: Server requires `--warden-root` argument pointing to a Warden environment folder containing `.env` with `WARDEN_ENV_NAME`
2. **Structured Tool Input**: All tools use Zod schemas for validation - no arbitrary shell execution allowed
3. **Container Isolation**: Commands execute inside Warden containers via `warden env exec php-fpm`
4. **Smart Timeouts**: Default 5 minutes, extended to 15-20 minutes for long operations (DI compile, static deploy)
5. **Security**: Automatic redaction of sensitive config values and environment variables in logs

### MCP Tool Registration Flow
1. Server initializes with project name from directory structure
2. `registerMagentoTools()` adds Magento-specific tools with project context
3. `registerWardenTools()` adds Warden container management tools
4. Each tool validates inputs via Zod, executes via `run()` function, returns structured responses

### Testing Strategy
- **Unit Tests**: Cover env parsing, argument validation, output cleaning, redaction logic
- **E2E Tests**: Playwright scaffolding ready for MCP client integration tests
- **Fixtures**: Mock `warden` binary and test project structures in `tests/fixtures/`

## Important Implementation Notes

1. **MCP Inspector Compatibility**: Always use built version (`node dist/index.js`) for MCP Inspector. Dev mode (`pnpm run dev`) outputs logs that break stdio protocol.

2. **Logging Behavior**: 
   - `MCP_STDIO_MODE=true` is automatically set to prevent console logging when running as MCP server
   - Production logging (`NODE_ENV=production`) writes to `logs/` directory with rotation
   - Development shows debug-level console output unless in stdio mode

3. **Command Execution Safety**:
   - All Magento commands run through `wardenMagento()` helper with memory limit removed
   - Sensitive values (passwords, tokens) are redacted in logs
   - Commands have project identification prefix: `[project/env @ domain]`

4. **Zod Version Requirement**: Must use Zod 3.x for MCP SDK compatibility. If you see `keyValidator._parse is not a function`, reinstall: `pnpm remove zod && pnpm add zod@^3.23.8`