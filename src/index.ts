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

// Validate warden root (do not exit; allow MCP to start with tools even if invalid)
try {
  assertWardenProject(wardenRoot);
  logger.info(`Warden project validated successfully at: ${wardenRoot}`);
} catch (error) {
  logger.warn(
    `Warden project validation failed: ${error instanceof Error ? error.message : String(error)}. Starting MCP anyway; many tools may fail until --warden-root is set to a valid Warden project.`
  );
  logger.warn(`Usage: --warden-root /path/to/warden/env`);
}

// Get project info for better identification
const projectName = path.basename(path.dirname(wardenRoot));
const wardenDirName = path.basename(wardenRoot);
const uniqueId = `${projectName}-${wardenDirName}`;

// Create a short prefix for tool names (max 60 char limit)
// Use first 2-3 chars of project + first 1-2 chars of warden dir
function createShortPrefix(projectName: string, wardenDirName: string): string {
  const projectPrefix = projectName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3);
  const wardenPrefix = wardenDirName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 2);
  return `${projectPrefix}${wardenPrefix}`;
}

const shortPrefix = createShortPrefix(projectName, wardenDirName);

const server = new McpServer({
  name: `warden-magento-${uniqueId}`,
  version: "1.0.0",
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
  },
});

logger.info(`Initializing MCP server: warden-magento-${uniqueId} v1.0.0`);

registerMagentoTools(server, wardenRoot, shortPrefix);
registerWardenTools(server, wardenRoot, shortPrefix);

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
