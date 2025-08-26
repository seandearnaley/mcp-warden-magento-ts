# mcp-warden-magento (TypeScript, stdio)

A minimal, safe **Model Context Protocol (MCP)** server that exposes a toolbox for **Magento 2** tasks inside **Warden** environments. It favors **stateless** execution via `warden env exec` (recommended), supports **multiple concurrent projects** by passing `projectRoot`, and is ready to use with **MCP Inspector** and **Claude Desktop**.

> This repository deliberately avoids keeping PTY/shell sessions open. You can add that later if you prove a latency win. For most teams, ephemeral `warden env exec` is simpler and robust.

---

## Quick start

1) **Install dependencies**

```bash
pnpm i
```

2) **Run with MCP Inspector (recommended for testing)**

```bash
npx @modelcontextprotocol/inspector pnpm run dev
```

- In the Inspector UI, you should see the server name `mcp-warden-magento`.
- Try a tool call:
  - `magento.cacheClean` with input:
    ```json
    { "projectRoot": "/absolute/path/to/your/warden/magento2/project" }
    ```

3) **Run with Claude Desktop (stdio)**

- Add a local MCP server pointing to your project:
  - **Command:** `pnpm`
  - **Args:** `run dev`
  - **CWD:** the repo folder
- Then invoke tools by name (e.g., “Run `magento.setupUpgrade` in /path/to/project”).

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

Just pass the **right `projectRoot`** and we’ll run in that environment. The Warden `.env` inside that folder ensures the correct containers are targeted.

---

## Requirements

- Node.js >= 18
- Warden installed and services up (`brew install wardenenv/warden/warden && warden svc up`)
- A Warden Magento 2 project initialized (`warden env-init`) and started (`warden env start`)

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

You can configure where `warden.discoverProjects` scans by setting env var **`MCP_WARDEN_SCAN_DIRS`** to a colon-separated list of directories (e.g., `/Users/you/Sites:/Users/you/Projects`). If unset, it will try a couple of common folders under your home directory (`Sites`, `Projects`) if they exist.

---

## Optional: persistent PTY (advanced)

If you later decide to keep a session open in `php-fpm`, consider wiring a guarded PTY behind a whitelist (e.g., `node-pty`). Keep one PTY per project, auto‑recreate after `warden env stop/start`, and never forward free‑form shell strings. This repo does not include PTY code by default.

---

## License

MIT
