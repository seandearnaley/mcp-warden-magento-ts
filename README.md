# Warden Magento MCP Server

A **Model Context Protocol (MCP)** server that provides AI assistants with safe, structured access to **Magento 2** operations within **Warden** environments. Each server instance is bound to a specific Warden project, eliminating confusion when working with multiple environments.

When working with Magento code with this tool enabled, good AI models will call the appropriate tools after edits. The AI knows when to clear cache, run di:compile, and run static:deploy better than most developers. This saves considerable time and eliminates context switching. It also makes accessing logs easier, which is normally a minor pain to do manually.

## ✨ Features

- 🎯 **Project-specific servers**: Each instance serves one Warden environment
- 🔧 **Comprehensive Magento tools**: Cache management, setup, deployment, indexing
- 🐳 **Warden integration**: Direct container execution via `warden env exec`
- 🏷️ **Clear identification**: All responses show which project was targeted
- 📊 **Production logging**: Winston-based logging with file rotation
- 🔒 **Safe execution**: Structured inputs only, no arbitrary shell access

## 🚀 Quick Start

### Option 1: Install from npm (Recommended)

```bash
# Install globally
npm install -g mcp-warden-magento

# Or use directly with npx
npx mcp-warden-magento --warden-root /Users/yourname/Documents/GitLab/warden-envs
```

### Option 2: Build from source

1. **Install dependencies**

```bash
pnpm install
```

2. **Build the project**

```bash
pnpm run build
```

3. **Test with MCP Inspector**

```bash
npx @modelcontextprotocol/inspector mcp-warden-magento --warden-root /Users/yourname/Documents/GitLab/warden-envs
```

### Development Mode

For development with auto-reload (local terminal use only):

```bash
pnpm run dev --warden-root /Users/yourname/Documents/GitLab/warden-envs
```

**Note**: `pnpm run dev` outputs startup messages that break MCP Inspector's stdio protocol. Use the built version (`node dist/index.js`) for MCP Inspector and client configurations.

## 📋 Requirements

- **Node.js** ≥ 18
- **Warden** installed and services running (`brew install wardenenv/warden/warden && warden svc up`)
- **Warden Magento 2 projects** initialized (`warden env-init`) and started (`warden env start`)

## ⚠️ Important: Zod Compatibility

This project requires **Zod 3.x** for MCP SDK compatibility. If you encounter `keyValidator._parse is not a function` errors:

```bash
pnpm remove zod && pnpm add zod@^3.23.8
pnpm run build
```

---

## 🎯 Primary Supported Clients

### 1. Cursor IDE (Recommended)

**Installation:**

1. Open Cursor settings: `Cmd/Ctrl + ,`
2. Search for "MCP" or go to Extensions → MCP
3. Add server configurations to your workspace or user settings

**Configuration Example:**

```json
{
  "mcp.servers": {
    "warden-magento": {
      "command": "npx",
      "args": ["mcp-warden-magento", "--warden-root", "/Users/yourname/Documents/GitLab/warden-envs"]
    },
    "warden-anotherwarden": {
      "command": "npx",
      "args": [
        "mcp-warden-magento",
        "--warden-root",
        "/Users/yourname/Documents/GitLab/anotherwarden/warden-envs-anotherwarden"
      ]
    }
  }
}
```

**Alternative: Using global installation**

```json
{
  "mcp.servers": {
    "warden-magento": {
      "command": "mcp-warden-magento",
      "args": ["--warden-root", "/Users/yourname/Documents/GitLab/warden-envs"]
    }
  }
}
```

**Usage in Cursor:**

- Use `@warden-magento` to target the magento project
- Use `@warden-anotherwarden` to target the anotherwarden project
- Example: "Hey @warden-magento, clear the config cache"

### 2. Claude Desktop

**Installation:**

1. Locate your Claude Desktop config: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add MCP server entries

**Configuration Example:**

```json
{
  "mcpServers": {
    "warden-magento": {
      "command": "npx",
      "args": ["mcp-warden-magento", "--warden-root", "/Users/yourname/Documents/GitLab/warden-envs"]
    },
    "warden-anotherwarden": {
      "command": "npx",
      "args": [
        "mcp-warden-magento",
        "--warden-root",
        "/Users/yourname/Documents/GitLab/anotherwarden/warden-envs-anotherwarden"
      ]
    }
  }
}
```

**Usage in Claude Desktop:**

- Restart Claude Desktop after configuration changes
- Claude will automatically detect available tools from both servers
- All responses include project identification: `[magento2 @ magento2.test]`

### 3. Claude Code (VS Code Extension)

**Installation:**

1. Install the Claude Code extension from VS Code marketplace
2. Configure MCP servers in VS Code settings

**Configuration Example:**
Add to your VS Code `settings.json`:

```json
{
  "claude-code.mcpServers": {
    "warden-magento": {
      "command": "npx",
      "args": ["mcp-warden-magento", "--warden-root", "/Users/yourname/Documents/GitLab/warden-envs"]
    },
    "warden-anotherwarden": {
      "command": "npx",
      "args": [
        "mcp-warden-magento",
        "--warden-root",
        "/Users/yourname/Documents/GitLab/anotherwarden/warden-envs-anotherwarden"
      ]
    }
  }
}
```

**Usage in Claude Code:**

- Use Claude Code commands to interact with Magento environments
- Each server appears as a separate MCP connection
- Project identification helps distinguish between environments

---

## 🛠️ Available Tools

### Magento Operations

- `magento.cacheClean` — Clean Magento cache types
- `magento.cacheFlush` — Flush Magento cache storage
- `magento.setupUpgrade` — Run setup:upgrade + cache clean
- `magento.diCompile` — Compile dependency injection
- `magento.staticDeploy` — Deploy static content
- `magento.indexerReindex` — Reindex all indexers
- `magento.modeShow` / `magento.modeSet` — Show/set deploy mode
- `magento.configSet` / `magento.configShow` — Manage configuration

### Warden Operations

- `warden.exec` — Execute commands in containers
- `warden.varnishFlush` — Clear Varnish cache
- `warden.redisFlushAll` — Flush Redis (use with caution)
- `warden.logsTail` — View recent container logs
- `warden.showEnv` — Display sanitized environment variables
- `warden.projectInfo` — Show current project information

## 🏗️ Multi-Project Setup

### Your GitLab Layout

```
~/Documents/GitLab/
├──
│   ├── warden-envs/          # ← Point --warden-root here
│   ├── app/
│   └── ...
└── anotherwarden/
    ├── warden-envs-anotherwarden/  # ← Point --warden-root here
    ├── app/
    └── ...
```

### Running Multiple Servers

```bash
# Terminal 1: magento server
npx mcp-warden-magento --warden-root /Users/yourname/Documents/GitLab/warden-envs

# Terminal 2: anotherwarden server
npx mcp-warden-magento --warden-root /Users/yourname/Documents/GitLab/anotherwarden/warden-envs-anotherwarden

# Or if installed globally:
mcp-warden-magento --warden-root /Users/yourname/Documents/GitLab/warden-envs
```

### Benefits

- ✅ **Clear server names**: `warden-magento-magento` vs `warden-magento-anotherwarden`
- ✅ **No parameter confusion**: No need to specify project in every tool call
- ✅ **Concurrent usage**: Run operations on both projects simultaneously
- ✅ **Project identification**: All responses prefixed with `[project/env @ domain]`

## 📊 Logging

### Log Levels & Environment Configuration

- **Development** (`NODE_ENV=development`): Debug-level console logging with colors (disabled automatically in MCP stdio mode)
- **Production** (`NODE_ENV=production`): Warning-level file logging with rotation

### File Logging (Production)

When `NODE_ENV=production` or `LOG_TO_FILE=true`:

- `logs/mcp-warden-magento.log` — All logs (JSON format, 5MB rotation)
- `logs/mcp-warden-magento-error.log` — Error logs only

### Environment Variables

- `NODE_ENV` — Set to `production` for production logging
- `LOG_TO_FILE` — Set to `true` to enable file logging in any environment
- `LOG_DIR` — Custom log directory (defaults to `./logs`)
- `MCP_STDIO_MODE` — When `true`, disables console logging to protect MCP stdio transport

### Examples

```bash
# Development with debug logging
NODE_ENV=development npx mcp-warden-magento --warden-root /path/to/warden/env

# Production with file logging
NODE_ENV=production npx mcp-warden-magento --warden-root /path/to/warden/env

# Force file logging in development
LOG_TO_FILE=true npx mcp-warden-magento --warden-root /path/to/warden/env
```

## 🔧 Development

### Scripts

- `pnpm run build` — Compile TypeScript to `dist/`
- `pnpm run dev` — Run with tsx (development only)
- `pnpm run lint` — Check code style
- `pnpm run format` — Format code with Prettier

### Testing

```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector mcp-warden-magento --warden-root /path/to/warden/env

# Test specific tools
# In Inspector UI, try: magento.cacheClean with { "types": ["config"] }
# Or: warden.projectInfo (no parameters needed)
```

### Automated Tests

- Unit tests (Vitest): `pnpm run test:unit`
- E2E tests (Playwright): `pnpm run test:e2e`

Notes:

- Unit tests cover env parsing/redaction, output cleaning, and input validation.
- E2E scaffolding is in place (Playwright) and ready to extend with a stubbed `warden` binary and an MCP stdio client.

## 🔒 Security

- **Structured inputs only**: All tools use Zod validation, no arbitrary shell execution
- **Container isolation**: Commands run inside Warden containers via `warden env exec`
- **Environment validation**: Server validates Warden project structure on startup
- **Smart timeouts**: Commands have execution timeouts (5 minutes default, 15 minutes for long operations like DI compile)
- **Sanitized output**: Environment variables are redacted in logs and responses

## 🚨 Troubleshooting

### Common Issues

**"keyValidator.\_parse is not a function"**

- Install Zod 3.x: `pnpm remove zod && pnpm add zod@^3.23.8`

**"WARDEN_ENV_NAME missing"**

- Ensure you're pointing to the correct warden environment folder
- Run `warden env-init` in your Magento project if needed

**"Command not found: warden"**

- Install Warden?
- Start services: `warden svc up`

**MCP client can't connect**

- Ensure absolute paths in client configuration
- Check that the built `dist/index.js` file exists
- Verify Node.js ≥ 18 is installed

**"Request timed out" for DI compile or static deploy**

- These operations can take 10-20 minutes on large projects
- **MCP Inspector**: Increase timeout in Configuration → `MCP_SERVER_REQUEST_TIMEOUT` to 1200000 (20 minutes)
- **Cursor/Claude**: The server automatically extends timeouts for long operations (20 minutes for DI compile)
- If still timing out, the operation may be stuck - check Magento logs

### Debug Mode

```bash
NODE_ENV=development LOG_TO_FILE=true npx mcp-warden-magento --warden-root /path/to/env
# Check logs/mcp-warden-magento.log for detailed information
```

---

## 📦 Publishing to npm

For maintainers:

```bash
# Test the package locally
pnpm run publish:dry

# Publish to npm (requires npm login)
npm publish

# Or publish with pnpm
pnpm publish
```

The `prepublishOnly` script will automatically run tests, linting, and build before publishing.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

For questions or issues, please open a GitHub issue with:

- Your client configuration
- Server logs (with sensitive data redacted)
- Steps to reproduce the problem
