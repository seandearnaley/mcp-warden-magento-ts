# mcp-warden-magento (TypeScript, stdio)

A minimal, safe **Model Context Protocol (MCP)** server that exposes a toolbox for **Magento 2** tasks inside **Warden** environments. It favors **stateless** execution via `warden env exec` (recommended), supports **multiple concurrent projects** by passing `projectRoot`, and is ready to use with **MCP Inspector** and **Claude Desktop**.

> This repository deliberately avoids keeping PTY/shell sessions open. You can add that later if you prove a latency win. For most teams, ephemeral `warden env exec` is simpler and robust.

---

## Quick start

1) **Install dependencies**

```bash
pnpm i
```

2) **Build for production (recommended)**

```bash
pnpm run build
```

3) **Run with MCP Inspector (recommended for testing)**

```bash
# For development (may have tsx startup messages):
npx @modelcontextprotocol/inspector pnpm run dev

# For production (clean stdio):
npx @modelcontextprotocol/inspector pnpm start
```

- In the Inspector UI, you should see the server name `mcp-warden-magento`.
- Try a tool call:
  - `magento.cacheClean` with input:
    ```json
    { "projectRoot": "/absolute/path/to/your/warden/magento2/project" }
    ```

4) **Project-Specific Setup (Recommended)**

Instead of passing `projectRoot` to every tool call, you can run project-specific MCP servers using the warden environment folder:

```bash
# For lv-magento project
npx @modelcontextprotocol/inspector node dist/index.js --warden-root /Users/seandearnaley/Documents/GitLab/lv-magento/warden-envs

# For lv-pfizer project  
npx @modelcontextprotocol/inspector node dist/index.js --warden-root /Users/seandearnaley/Documents/GitLab/lv-pfizer/warden-envs-pfizer-harper
```

This approach:
- ✅ Eliminates the need to specify `projectRoot` in every tool call
- ✅ Provides clear server names like `mcp-warden-magento-lv-magento`
- ✅ Allows running multiple project servers simultaneously
- ✅ Makes tool responses clearly identify which project they target

## Client Installation

### Claude Desktop

Add entries to your Claude Desktop MCP configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "warden-lv-magento": {
      "command": "node",
      "args": ["/path/to/mcp-warden-magento-ts/dist/index.js", "--warden-root", "/Users/seandearnaley/Documents/GitLab/lv-magento/warden-envs"],
      "cwd": "/path/to/mcp-warden-magento-ts"
    },
    "warden-lv-pfizer": {
      "command": "node", 
      "args": ["/path/to/mcp-warden-magento-ts/dist/index.js", "--warden-root", "/Users/seandearnaley/Documents/GitLab/lv-pfizer/warden-envs-pfizer-harper"],
      "cwd": "/path/to/mcp-warden-magento-ts"
    }
  }
}
```

### Cursor IDE

Add to your Cursor settings (`.cursor-settings/settings.json`):

```json
{
  "mcp.servers": {
    "warden-lv-magento": {
      "command": "node",
      "args": ["/path/to/mcp-warden-magento-ts/dist/index.js", "--warden-root", "/Users/seandearnaley/Documents/GitLab/lv-magento/warden-envs"],
      "cwd": "/path/to/mcp-warden-magento-ts"
    },
    "warden-lv-pfizer": {
      "command": "node",
      "args": ["/path/to/mcp-warden-magento-ts/dist/index.js", "--warden-root", "/Users/seandearnaley/Documents/GitLab/lv-pfizer/warden-envs-pfizer-harper"], 
      "cwd": "/path/to/mcp-warden-magento-ts"
    }
  }
}
```

### Claude Code (VS Code Extension)

Add to your VS Code `settings.json`:

```json
{
  "claude-code.mcpServers": {
    "warden-lv-magento": {
      "command": "node",
      "args": ["/path/to/mcp-warden-magento-ts/dist/index.js", "--warden-root", "/Users/seandearnaley/Documents/GitLab/lv-magento/warden-envs"],
      "cwd": "/path/to/mcp-warden-magento-ts"
    },
    "warden-lv-pfizer": {
      "command": "node",
      "args": ["/path/to/mcp-warden-magento-ts/dist/index.js", "--warden-root", "/Users/seandearnaley/Documents/GitLab/lv-pfizer/warden-envs-pfizer-harper"],
      "cwd": "/path/to/mcp-warden-magento-ts"
    }
  }
}
```

> Ensure your Warden project is started: from the **project root** run `warden env start`.
> The server’s tools expect `.env` (created by `warden env-init`) to be present in the project root.

---

## Why stateless?

- Spawning `warden env exec -T php-fpm php bin/magento ...` per call is reliable, safe, and works across **many concurrent Warden environments** on one machine.
- Keeping a persistent shell adds complexity (keepalive, reconnect, sanitization) and rarely improves real-world Magento CLI loops.

---

## Tools (initial set)

All tools accept a **`projectRoot`** parameter (absolute path to the Warden project).

Magento‑focused:
- `magento.cacheClean` — `bin/magento cache:clean [types?]`
- `magento.cacheFlush` — `bin/magento cache:flush [types?]`
- `magento.setupUpgrade` — `bin/magento setup:upgrade` then `cache:clean`
- `magento.diCompile` — `bin/magento setup:di:compile`
- `magento.staticDeploy` — `bin/magento setup:static-content:deploy [options]`
- `magento.indexerReindex` — `bin/magento indexer:reindex`
- `magento.modeShow` / `magento.modeSet` — show/set deploy mode
- `magento.configSet` / `magento.configShow` — set/read config values

Warden helpers:
- `warden.exec` — generic `warden env exec -T <service> <argv...>`
- `warden.varnishFlush` — `varnishadm 'ban req.url ~ .'`
- `warden.redisFlushAll` — `redis flushall`
- `warden.logsTail` — returns last N lines of selected services (no `-f` follow)
- `warden.discoverProjects` — scan directories for Warden `.env` with `WARDEN_ENV_NAME`
- `warden.showEnv` — dump safe `.env` pairs (redacts likely secrets)

> You can expand these by following the patterns in `src/tools/*.ts`.

---

## Multiple environments

With the project-specific server approach, each MCP server is bound to a single Warden project at startup. This eliminates confusion and makes multi-project workflows much cleaner.

### Examples with your GitLab layout

For your setup with projects under `~/Documents/GitLab`:

- `/Users/seandearnaley/Documents/GitLab/lv-magento/warden-envs` (Warden env A)
- `/Users/seandearnaley/Documents/GitLab/lv-pfizer/warden-envs-pfizer-harper` (Warden env B)

Run separate MCP servers:

```bash
# Terminal 1: lv-magento server
node dist/index.js --warden-root /Users/seandearnaley/Documents/GitLab/lv-magento/warden-envs

# Terminal 2: lv-pfizer server  
node dist/index.js --warden-root /Users/seandearnaley/Documents/GitLab/lv-pfizer/warden-envs-pfizer-harper
```

Or configure both in your MCP client (Claude Desktop, Cursor, etc.) as shown in the Client Installation section above.

### Benefits of project-specific servers:
- ✅ **No confusion**: Each server is clearly named (e.g., `mcp-warden-magento-lv-magento`)
- ✅ **Simpler tool calls**: No need to specify `projectRoot` parameter
- ✅ **Clear responses**: All outputs are prefixed with `[project-name/env-name @ domain]`
- ✅ **Concurrent usage**: Run multiple servers simultaneously for different projects
- ✅ **Warden env isolation**: Each server uses the correct `.env` from its project root

---

## Requirements

- Node.js >= 18
- Warden installed and services up (`brew install wardenenv/warden/warden && warden svc up`)
- A Warden Magento 2 project initialized (`warden env-init`) and started (`warden env start`)

## Important: Zod Compatibility

This project requires **Zod 3.x** for compatibility with the MCP SDK. If you encounter `keyValidator._parse is not a function` errors, ensure you're using the correct Zod version:

```bash
pnpm remove zod && pnpm add zod@^3.23.8
pnpm run build
```

---

## Scripts

- `pnpm run dev` — runs the MCP server via `tsx` (ESM, TypeScript)
- `pnpm run build` — compiles TypeScript to `dist`
- `pnpm start` — runs built JS via Node

---

## Security notes

- Tools only accept structured inputs (Zod validated).
- We **do not** expose arbitrary shell execution to the LLM.
- Each command is spawned with a **timeout** and returns `stdout`, `stderr`, and exit code.

---

## Project discovery

You can configure where `warden.discoverProjects` scans by setting env var **`MCP_WARDEN_SCAN_DIRS`** to a colon-separated list of directories (e.g., `/Users/you/Sites:/Users/you/Projects:/Users/you/Documents/GitLab`). If unset, it will try common folders under your home directory (`Sites`, `Projects`, and `Documents/GitLab` when present).

Example to prefer your GitLab workspace on macOS:

```bash
export MCP_WARDEN_SCAN_DIRS="/Users/seandearnaley/Documents/GitLab"
```

---

## Optional: persistent PTY (advanced)

If you later decide to keep a session open in `php-fpm`, consider wiring a guarded PTY behind a whitelist (e.g., `node-pty`). Keep one PTY per project, auto‑recreate after `warden env stop/start`, and never forward free‑form shell strings. This repo does not include PTY code by default.

---

## License

MIT
