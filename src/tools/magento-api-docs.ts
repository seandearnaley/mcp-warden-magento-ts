import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverEndpoints, getProjectBadge, type Endpoint } from "./magento-helpers.js";

export function registerApiDocsTools(server: McpServer, projectRoot: string) {
  server.tool(
    "magento.apiDocs",
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

      let endpoints = await discoverEndpoints(projectRoot);
      if (moduleFilter) endpoints = endpoints.filter((e) => e.module.includes(moduleFilter));
      if (prefixFilter) endpoints = endpoints.filter((e) => e.url.startsWith(prefixFilter));
      if (format === "json") {
        const json = JSON.stringify(
          { project: getProjectBadge(projectRoot), total: endpoints.length, endpoints },
          null,
          2
        );
        return { content: [{ type: "text", text: json }] };
      }
      // summary: only totals by module and grand total
      const lines: string[] = [];
      lines.push(`${getProjectBadge(projectRoot)} API Catalog`);
      const byModule: Record<string, Endpoint[]> = {};
      for (const e of endpoints) {
        if (!byModule[e.module]) byModule[e.module] = [];
        byModule[e.module].push(e);
      }
      const modules = Object.keys(byModule).sort();
      const total = endpoints.length;
      lines.push(`\nTotal endpoints: ${total}`);
      lines.push(`Modules: ${modules.length}`);
      for (const mod of modules) {
        lines.push(`  ${mod}: ${byModule[mod].length}`);
      }

      if (format === "endpoints-only") {
        const off = offset ?? 0;
        const lim = limit ?? 50;
        const slice = endpoints.slice(off, off + lim);
        lines.push(`\nEndpoints ${off + 1}-${off + slice.length} of ${total}`);
        for (const e of slice) {
          lines.push(`  ${e.httpMethod} ${e.url} (${e.auth})`);
        }
        if (off + slice.length < total) {
          lines.push(`  ... ${total - (off + slice.length)} more (use offset/limit)`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "magento.apiDocsEndpoint",
    "Return documentation for a single endpoint id",
    {
      id: z.string().describe("Endpoint id: Namespace\\Interface.method"),
    },
    async (args) => {
      const { id } = args as { id: string };
      const endpoints = await discoverEndpoints(projectRoot);
      const e = endpoints.find((x) => x.id === id);
      if (!e) return { content: [{ type: "text", text: `${getProjectBadge(projectRoot)} Endpoint not found: ${id}` }] };
      const lines: string[] = [];
      lines.push(`${getProjectBadge(projectRoot)} Endpoint`);
      lines.push(`ID: ${e.id}`);
      lines.push(`Method: ${e.httpMethod}`);
      lines.push(`Path: ${e.url}`);
      lines.push(`Auth: ${e.auth}`);
      lines.push(`Service: ${e.serviceClass}::${e.serviceMethod}`);
      lines.push(`Module: ${e.module}`);
      if (e.params.length > 0) {
        lines.push(`\nParams:`);
        for (const p of e.params) {
          lines.push(
            `  - ${p.name}: ${p.type}${p.optional ? " (optional)" : ""}${p.defaultValue ? ` = ${p.defaultValue}` : ""}`
          );
        }
      } else {
        lines.push(`\nParams: (none)`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
