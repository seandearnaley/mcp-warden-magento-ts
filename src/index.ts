import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMagentoTools } from "./tools/magento.js";
import { registerWardenTools } from "./tools/warden.js";
import { assertWardenProject } from "./lib/exec.js";
import * as path from "node:path";

// Parse command line arguments
const args = process.argv.slice(2);
const wardenRootIndex = args.findIndex((arg) => arg === "--warden-root");
const wardenRoot =
  wardenRootIndex !== -1 && args[wardenRootIndex + 1] ? path.resolve(args[wardenRootIndex + 1]) : process.cwd();

// Validate warden root
try {
  assertWardenProject(wardenRoot);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Usage: node dist/index.js --warden-root /path/to/warden/env/folder`);
  console.error(
    `Example: node dist/index.js --warden-root /Users/seandearnaley/Documents/GitLab/lv-magento/warden-envs`
  );
  process.exit(1);
}

const server = new McpServer({
  name: `mcp-warden-magento-${path.basename(wardenRoot)}`,
  version: "1.0.0",
  capabilities: { tools: {} },
});

registerMagentoTools(server, wardenRoot);
registerWardenTools(server, wardenRoot);

const transport = new StdioServerTransport();
await server.connect(transport);
