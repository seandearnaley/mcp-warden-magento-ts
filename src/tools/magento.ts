import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectInfo, wardenExec } from "../lib/exec.js";
import { createLogger } from "../lib/logger.js";
import { readDotEnv } from "../lib/env.js";
import * as fs from "node:fs";
import { registerApiDocsTools } from "./magento-api-docs.js";
import { registerApiTryTool } from "./magento-api-try.js";
import { registerMagentoCliTools } from "./magento-cli.js";

export function registerMagentoTools(server: McpServer, projectRoot: string, shortPrefix?: string) {
  const logger = createLogger("magento-tools");
  const projectInfo = getProjectInfo(projectRoot);

  logger.info(`Registering Magento tools for project: ${projectInfo}`);

  // Prevent duplicate tool registration during refactor period
  const alreadyRegistered = new Set<string>();
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

  function defineTool(
    name: string,
    description: string,
    schema: z.ZodRawShape | Record<string, unknown>,
    handler: ToolHandler
  ): void {
    if (alreadyRegistered.has(name)) return;
    alreadyRegistered.add(name);
    server.tool(name, description, schema as z.ZodRawShape, handler);

    // Test-only legacy alias (dotted, non-prefixed)
    if (process.env.NODE_ENV === "test") {
      let legacy = name;
      if (toolPrefix && legacy.startsWith(toolPrefix)) legacy = legacy.slice(toolPrefix.length);
      const usIdx = legacy.indexOf("_");
      if (usIdx > 0) {
        const dotted = `${legacy.slice(0, usIdx)}.${legacy.slice(usIdx + 1)}`;
        if (!alreadyRegistered.has(dotted)) {
          alreadyRegistered.add(dotted);
          server.tool(dotted, description, schema as z.ZodRawShape, handler);
        }
      }
    }
  }

  // Register modular groups
  registerApiDocsTools(server, projectRoot, shortPrefix);
  registerApiTryTool(server, projectRoot, shortPrefix);
  registerMagentoCliTools(server, projectRoot, shortPrefix);

  // Helper: Perform punchin auth using cXML and return curl cookie args
  async function punchinCookieArgs(
    baseCurlUrl: string,
    hostHeader: string,
    punchinXmlContent?: string,
    cookiePath?: string
  ): Promise<string[]> {
    // 1) Punch in to get token/StartPage (save cookies)
    let punchinRes: { ok: boolean; stdout: string; stderr: string };
    const cookieFile = cookiePath ?? `/tmp/mcp-cookies-${hostHeader}.txt`;
    if (punchinXmlContent) {
      // Safely write XML into container then post it
      const xmlB64 = Buffer.from(punchinXmlContent, "utf8").toString("base64");
      const cmd = [
        "bash",
        "-lc",
        `echo '${xmlB64}' | base64 -d > /tmp/punchin.xml && curl -s -L -c ${cookieFile} -b ${cookieFile} -H 'Content-Type: application/xml' -H 'Host: ${hostHeader}' --data-binary @/tmp/punchin.xml ${baseCurlUrl}/rest/V1/lvapi/gettoken`,
      ];
      punchinRes = await wardenExec(projectRoot, "php-fpm", cmd);
    } else {
      const punchinArgs: string[] = [
        "curl",
        "-s",
        "-L",
        "-c",
        cookieFile,
        "-b",
        cookieFile,
        "-H",
        "Content-Type: application/xml",
        "-H",
        `Host: ${hostHeader}`,
        "--data-binary",
        "@/tmp/punchin.xml",
        `${baseCurlUrl}/rest/V1/lvapi/gettoken`,
      ];
      punchinRes = await wardenExec(projectRoot, "php-fpm", punchinArgs);
    }
    if (!punchinRes.ok) return [];

    // 2) Extract StartPage and visit to establish session
    const match = punchinRes.stdout.match(/<URL>(https?:\/\/[^<]*)<\/URL>/);
    const fullUrl = match?.[1];
    if (fullUrl) {
      const pathMatch = fullUrl.match(/^https?:\/\/[^/]+(\/.*)$/);
      const pathOnly = pathMatch?.[1] ?? "/";
      const sessionArgs: string[] = [
        "curl",
        "-s",
        "-L",
        "-c",
        cookieFile,
        "-b",
        cookieFile,
        "-H",
        `Host: ${hostHeader}`,
        `${baseCurlUrl}${pathOnly}`,
      ];
      await wardenExec(projectRoot, "php-fpm", sessionArgs);
    }
    return ["-b", cookieFile];
  }

  // Generic authenticated REST/GraphQL caller
  defineTool(
    `${toolPrefix}magento_apiCall`,
    "Call a REST or GraphQL endpoint with optional punchin auth",
    {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      path: z.string().describe("REST path starting with / or 'graphql' for GraphQL"),
      query: z.record(z.string(), z.string()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.record(z.string(), z.any()).optional(),
      graphqlQuery: z.string().optional(),
      authenticate: z.boolean().optional(),
      punchinXmlPath: z.string().optional(),
      authenticateReuse: z.boolean().optional(),
    },
    async (args) => {
      const {
        method,
        path: apiPath,
        query = {},
        headers = {},
        body,
        graphqlQuery,
        authenticate,
        punchinXmlPath,
      } = args as {
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        path: string;
        query?: Record<string, string>;
        headers?: Record<string, string>;
        body?: Record<string, unknown>;
        graphqlQuery?: string;
        authenticate?: boolean;
        punchinXmlPath?: string;
        authenticateReuse?: boolean;
      };

      const env = readDotEnv(projectRoot);
      const host =
        env["TRAEFIK_SUBDOMAIN"] && env["TRAEFIK_DOMAIN"]
          ? `${env["TRAEFIK_SUBDOMAIN"]}.${env["TRAEFIK_DOMAIN"]}`
          : "localhost";
      const protocol = env["TRAEFIK_TLS"] === "true" ? "https" : "http";
      const baseCurlUrl = `${protocol}://${host}`;

      let punchinXmlContent: string | undefined;
      if (authenticate && punchinXmlPath) {
        if (fs.existsSync(punchinXmlPath)) {
          punchinXmlContent = fs.readFileSync(punchinXmlPath, "utf8");
        }
      }

      const cookieArgs = authenticate ? await punchinCookieArgs(baseCurlUrl, host, punchinXmlContent) : [];

      const curlArgs = ["curl", "-s", "-L", "-X", method, ...cookieArgs];

      // Add headers
      for (const [key, value] of Object.entries(headers)) {
        curlArgs.push("-H", `${key}: ${value}`);
      }
      curlArgs.push("-H", `Host: ${host}`);

      // Handle GraphQL vs REST
      if (apiPath === "graphql" && graphqlQuery) {
        curlArgs.push("-H", "Content-Type: application/json");
        curlArgs.push("--data-raw", JSON.stringify({ query: graphqlQuery }));
      } else if (body && ["POST", "PUT", "PATCH"].includes(method)) {
        curlArgs.push("-H", "Content-Type: application/json");
        curlArgs.push("--data-raw", JSON.stringify(body));
      }

      // Add query parameters
      let fullPath = apiPath;
      const queryString = new URLSearchParams(query).toString();
      if (queryString) {
        fullPath += `?${queryString}`;
      }

      curlArgs.push(`${baseCurlUrl}${fullPath}`);

      const res = await wardenExec(projectRoot, "php-fpm", curlArgs);
      const responseText = res.ok ? res.stdout : `Error: ${res.stderr}`;

      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} API Call\n\nRequest: ${method} ${fullPath}\n\nResponse:\n${responseText}`,
          },
        ],
      };
    }
  );

  // API Discovery tool
  defineTool(
    `${toolPrefix}magento_apiDiscover`,
    "Discover available REST and GraphQL APIs in this Magento instance",
    {
      type: z.enum(["rest", "graphql", "both"]).optional().default("both"),
      format: z.enum(["summary", "detailed", "endpoints-only"]).optional().default("summary"),
      authenticate: z.boolean().optional().describe("Use punchin authentication for protected endpoints"),
      punchinXmlPath: z.string().optional().describe("Path to punchin XML on host; if provided, used per call"),
      authenticateReuse: z.boolean().optional().describe("Reuse a cached cookie for this host during session"),
    },
    async (args) => {
      const { type, format, authenticate, punchinXmlPath } = args as {
        type?: "rest" | "graphql" | "both";
        format?: "summary" | "detailed" | "endpoints-only";
        authenticate?: boolean;
        punchinXmlPath?: string;
        authenticateReuse?: boolean;
      };

      const env = readDotEnv(projectRoot);
      const host =
        env["TRAEFIK_SUBDOMAIN"] && env["TRAEFIK_DOMAIN"]
          ? `${env["TRAEFIK_SUBDOMAIN"]}.${env["TRAEFIK_DOMAIN"]}`
          : "localhost";
      const protocol = env["TRAEFIK_TLS"] === "true" ? "https" : "http";
      const baseCurlUrl = `${protocol}://${host}`;

      let punchinXmlContent: string | undefined;
      if (authenticate && punchinXmlPath) {
        if (fs.existsSync(punchinXmlPath)) {
          punchinXmlContent = fs.readFileSync(punchinXmlPath, "utf8");
        }
      }

      const cookieArgs = authenticate ? await punchinCookieArgs(baseCurlUrl, host, punchinXmlContent) : [];

      const results: string[] = [];

      // Discover REST APIs
      if (type === "rest" || type === "both") {
        const restArgs = [
          "curl",
          "-s",
          "-L",
          ...cookieArgs,
          "-H",
          `Host: ${host}`,
          `${baseCurlUrl}/rest/default/schema`,
        ];
        const restRes = await wardenExec(projectRoot, "php-fpm", restArgs);
        if (restRes.ok) {
          results.push("REST API Schema discovered");
          if (format === "detailed") {
            results.push(`${restRes.stdout.substring(0, 1000)}...`);
          }
        }
      }

      // Discover GraphQL APIs
      if (type === "graphql" || type === "both") {
        const introspectionQuery = `
          query IntrospectionQuery {
            __schema {
              types {
                name
                kind
                description
              }
            }
          }
        `;
        const gqlArgs = [
          "curl",
          "-s",
          "-L",
          ...cookieArgs,
          "-H",
          `Host: ${host}`,
          "-H",
          "Content-Type: application/json",
          "--data-raw",
          JSON.stringify({ query: introspectionQuery }),
          `${baseCurlUrl}/graphql`,
        ];
        const gqlRes = await wardenExec(projectRoot, "php-fpm", gqlArgs);
        if (gqlRes.ok) {
          results.push("GraphQL Schema discovered");
          if (format === "detailed") {
            results.push(`${gqlRes.stdout.substring(0, 1000)}...`);
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} API Discovery\n\n${results.join("\n\n")}`,
          },
        ],
      };
    }
  );
}
