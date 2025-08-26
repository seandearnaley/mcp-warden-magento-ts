import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMagentoTools } from "./tools/magento.js";
import { registerWardenTools } from "./tools/warden.js";

const server = new McpServer({
  name: "mcp-warden-magento",
  version: "1.0.0",
  capabilities: { tools: {} },
});

registerMagentoTools(server);
registerWardenTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
