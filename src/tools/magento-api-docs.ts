import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverEndpoints, getProjectBadge, type Endpoint } from "./magento-helpers.js";

export function registerApiDocsTools(server: McpServer, projectRoot: string, shortPrefix?: string) {
  const toolPrefix = shortPrefix ? `${shortPrefix}_` : "";

  type ToolHandler = (args: Record<string, unknown>) =>
    | {
        content: Array<{ type: "text"; text: string; _meta?: Record<string, unknown> }>;
        _meta?: Record<string, unknown>;
      }
    | Promise<{
        content: Array<{ type: "text"; text: string; _meta?: Record<string, unknown> }>;
        _meta?: Record<string, unknown>;
      }>;

  const already = new Set<string>();
  function defineTool(
    name: string,
    description: string,
    schema: z.ZodRawShape | Record<string, unknown>,
    handler: ToolHandler
  ): void {
    if (already.has(name)) return;
    already.add(name);
    server.tool(name, description, schema as z.ZodRawShape, handler);
    if (process.env.NODE_ENV === "test") {
      let legacy = name;
      if (toolPrefix && legacy.startsWith(toolPrefix)) legacy = legacy.slice(toolPrefix.length);
      const usIdx = legacy.indexOf("_");
      if (usIdx > 0) {
        const dotted = `${legacy.slice(0, usIdx)}.${legacy.slice(usIdx + 1)}`;
        if (!already.has(dotted)) {
          already.add(dotted);
          server.tool(dotted, description, schema as z.ZodRawShape, handler);
        }
      }
    }
  }

  defineTool(
    `${toolPrefix}magento_apiDocs`,
    "Generate API catalog (OpenAPI-like) from webapi.xml and interfaces",
    {
      format: z.enum(["summary", "endpoints-only", "json"]).optional().default("summary"),
      limit: z.number().int().min(1).max(200).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
      moduleFilter: z.string().optional(),
      prefixFilter: z.string().optional(),
    },
    async (args) => {
      const { format, limit, offset, moduleFilter, prefixFilter } = args as {
        format?: "summary" | "endpoints-only" | "json";
        limit?: number;
        offset?: number;
        moduleFilter?: string;
        prefixFilter?: string;
      };

      const lim = limit ?? 50;
      const off = offset ?? 0;

      let endpoints: Endpoint[] = await discoverEndpoints(projectRoot);
      if (moduleFilter) {
        endpoints = endpoints.filter((ep) => ep.id.toLowerCase().includes(moduleFilter.toLowerCase()));
      }
      if (prefixFilter) {
        endpoints = endpoints.filter((ep) => ep.id.toLowerCase().startsWith(prefixFilter.toLowerCase()));
      }

      const total = endpoints.length;
      const paginatedEndpoints = endpoints.slice(off, off + lim);

      if (format === "json") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ total, offset: off, limit: lim, endpoints: paginatedEndpoints }, null, 2),
            },
          ],
        };
      }

      if (format === "endpoints-only") {
        const endpointList = paginatedEndpoints.map((ep) => `${ep.id}`).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${getProjectBadge(projectRoot)} API Endpoints (${off + 1}-${Math.min(off + lim, total)} of ${total})\n\n${endpointList}`,
            },
          ],
        };
      }

      const summary = paginatedEndpoints
        .map((ep) => {
          const params = ep.params.length > 0 ? ` (${ep.params.length} params)` : "";
          return `${ep.id}${params}\n  ${ep.httpMethod} ${ep.url}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `${getProjectBadge(projectRoot)} API Catalog (${off + 1}-${Math.min(off + lim, total)} of ${total})\n\n${summary}`,
          },
        ],
      };
    }
  );

  defineTool(
    `${toolPrefix}magento_apiDocsEndpoint`,
    "Return documentation for a single endpoint id",
    { id: z.string().describe("Endpoint id: Namespace\\Interface.method") },
    async (args) => {
      const { id } = args as { id: string };
      const endpoints = await discoverEndpoints(projectRoot);
      const endpoint = endpoints.find((ep) => ep.id === id);
      if (!endpoint) {
        return {
          content: [
            {
              type: "text",
              text: `${getProjectBadge(projectRoot)} Endpoint Not Found\n\nEndpoint '${id}' not found in API catalog.`,
            },
          ],
        };
      }

      const details = [
        `Endpoint: ${endpoint.id}`,
        `Method: ${endpoint.httpMethod}`,
        `URL: ${endpoint.url}`,
        `Module: ${endpoint.module}`,
        `Service: ${endpoint.serviceClass}`,
        `Method: ${endpoint.serviceMethod}`,
        "",
        "Parameters:",
        ...endpoint.params.map((p) => `  ${p.name}: ${p.type}${p.optional ? " (optional)" : ""}`),
      ].join("\n");

      return { content: [{ type: "text", text: `${getProjectBadge(projectRoot)} API Documentation\n\n${details}` }] };
    }
  );
}
