#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMagentoTools } from "./tools/magento.js";
import { registerWardenTools } from "./tools/warden.js";
import { assertWardenProject } from "./lib/exec.js";
import { logger } from "./lib/logger.js";
import * as path from "node:path";
import process from "node:process";

// Set environment variable to prevent console logging in stdio mode
process.env.MCP_STDIO_MODE = "true";

// Basic process lifecycle and error handling
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`Unhandled promise rejection: ${msg}`);
  process.exitCode = 2;
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(2);
});

// Parse command line arguments
const args = process.argv.slice(2);
const wardenRootIndex = args.findIndex((arg) => arg === "--warden-root");
const wardenRoot =
  wardenRootIndex !== -1 && args[wardenRootIndex + 1] ? path.resolve(args[wardenRootIndex + 1]) : process.cwd();

// Validate warden root
try {
  assertWardenProject(wardenRoot);
  logger.info(`Warden project validated successfully at: ${wardenRoot}`);
} catch (error) {
  logger.error(`Warden project validation failed: ${error instanceof Error ? error.message : String(error)}`);
  logger.error(`Usage: node dist/index.js --warden-root /path/to/warden/env/folder`);
  logger.error(`Example: node dist/index.js --warden-root /Users/yourname/Documents/GitLab/warden-envs`);
  process.exit(1);
}

// Get project info for better identification
const projectName = path.basename(path.dirname(wardenRoot));

const server = new McpServer({
  name: `warden-magento-${projectName}`,
  version: "1.0.0",
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
  },
});

logger.info(`Initializing MCP server: mcp-warden-magento-${path.basename(wardenRoot)} v1.0.0`);

registerMagentoTools(server, wardenRoot);
registerWardenTools(server, wardenRoot);

const transport = new StdioServerTransport();
logger.info("Connecting to MCP transport...");
await server.connect(transport);
logger.info("MCP server connected successfully");

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.warn(`Received ${signal}. Shutting down MCP server...`);
  // Stdio transport will end when process exits
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
