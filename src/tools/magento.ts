import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wardenMagento, getProjectInfo, cleanMagentoOutput, wardenExec } from "../lib/exec.js";
import { createLogger } from "../lib/logger.js";
import { readDotEnv } from "../lib/env.js";
import * as fs from "node:fs";

export function registerMagentoTools(server: McpServer, projectRoot: string) {
  const logger = createLogger("magento-tools");
  const projectInfo = getProjectInfo(projectRoot);

  logger.info(`Registering Magento tools for project: ${projectInfo}`);

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

  type EndpointParam = {
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: string;
  };

  type Endpoint = {
    id: string;
    url: string;
    httpMethod: string;
    auth: string;
    serviceClass: string;
    serviceMethod: string;
    module: string;
    params: EndpointParam[];
  };

  async function discoverEndpoints(): Promise<Endpoint[]> {
    const findRes = await wardenExec(projectRoot, "php-fpm", ["find", "app/code", "-name", "webapi.xml", "-type", "f"]);
    if (!findRes.ok || !findRes.stdout.trim()) return [];
    const files = findRes.stdout.trim().split("\n");
    const endpoints: Endpoint[] = [];

    for (const file of files) {
      const catRes = await wardenExec(projectRoot, "php-fpm", ["bash", "-lc", `cat ${file} | tr -d "\r"`]);
      if (!catRes.ok) continue;
      const xml = catRes.stdout;

      const routeRegex = /<route\s+url="([^"]+)"\s+method="([^"]+)">([\s\S]*?)<\/route>/g;
      const routeMatches = Array.from(xml.matchAll(routeRegex));
      for (const routeMatch of routeMatches) {
        const url = routeMatch[1];
        const httpMethod = routeMatch[2];
        const inner = routeMatch[3];
        const serviceMatch = /<service\s+class="([^"]+)"\s+method="([^"]+)"\/?>(?:\s*)/m.exec(inner);
        const resourceMatch = /<resource\s+ref="([^"]+)"\/?>(?:\s*)/m.exec(inner);
        if (!serviceMatch) continue;
        const serviceClass = serviceMatch[1];
        const serviceMethod = serviceMatch[2];
        const authRef = resourceMatch?.[1] ?? "unknown";
        const module = serviceClass.split("\\").slice(0, 2).join("/");

        // Try to resolve interface file and parse parameters
        const ifacePath = `app/code/${serviceClass.replace(/\\/g, "/")}.php`;
        const sigRes = await wardenExec(projectRoot, "php-fpm", [
          "bash",
          "-lc",
          `test -f ${ifacePath} && cat ${ifacePath} | tr -d "\r" || true`,
        ]);
        const params: EndpointParam[] = [];
        if (sigRes.ok && sigRes.stdout.trim()) {
          const iface = sigRes.stdout;
          const methodRegex = new RegExp(`function\\s+${serviceMethod}\\s*\\(([^)]*)\\)`, "m");
          const m = methodRegex.exec(iface);
          if (m?.[1] !== undefined) {
            const rawParams = m[1].trim();
            if (rawParams.length > 0) {
              const parts = rawParams.split(/,\s*/);
              for (const p of parts) {
                // Examples: 'string $queryText', 'int $from = 0', '$skus = []'
                const typeMatch =
                  /^(?:([a-zA-Z_\\][a-zA-Z0-9_\\]*)\s+)?\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*([^,]+))?$/.exec(p.trim());
                if (typeMatch) {
                  const pType = (typeMatch[1] ?? "mixed").trim();
                  const pName = typeMatch[2];
                  const defVal = typeMatch[3]?.trim();
                  params.push({ name: pName, type: pType, optional: Boolean(defVal), defaultValue: defVal });
                }
              }
            }
          }
        }

        const id = `${serviceClass}.${serviceMethod}`;
        endpoints.push({ id, url, httpMethod, auth: authRef, serviceClass, serviceMethod, module, params });
      }
    }
    // Sort for stable output
    endpoints.sort((a, b) => (a.url === b.url ? a.httpMethod.localeCompare(b.httpMethod) : a.url.localeCompare(b.url)));
    return endpoints;
  }

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

      let endpoints = await discoverEndpoints();
      if (moduleFilter) endpoints = endpoints.filter((e) => e.module.includes(moduleFilter));
      if (prefixFilter) endpoints = endpoints.filter((e) => e.url.startsWith(prefixFilter));
      if (format === "json") {
        const json = JSON.stringify({ project: projectInfo, total: endpoints.length, endpoints }, null, 2);
        return { content: [{ type: "text", text: json }] };
      }
      // summary: only totals by module and grand total
      const lines: string[] = [];
      lines.push(`${projectInfo} API Catalog`);
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
      const endpoints = await discoverEndpoints();
      const e = endpoints.find((x) => x.id === id);
      if (!e) return { content: [{ type: "text", text: `${projectInfo} Endpoint not found: ${id}` }] };
      const lines: string[] = [];
      lines.push(`${projectInfo} Endpoint`);
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

  server.tool(
    "magento.apiTry",
    "Call an endpoint by id with a single params object and optional auth",
    {
      id: z.string().describe("Endpoint id: Namespace\\Interface.method"),
      params: z.record(z.string(), z.any()).optional(),
      authenticate: z.boolean().optional(),
      punchinXmlPath: z.string().optional(),
      authenticateReuse: z.boolean().optional(),
      methodOverride: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    },
    async (args) => {
      const { id, params, authenticate, punchinXmlPath, authenticateReuse, methodOverride } = args as {
        id: string;
        params?: Record<string, unknown>;
        authenticate?: boolean;
        punchinXmlPath?: string;
        authenticateReuse?: boolean;
        methodOverride?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      };

      const endpoints = await discoverEndpoints();
      const endpoint = endpoints.find((e) => e.id === id);
      if (!endpoint) {
        return { content: [{ type: "text", text: `${projectInfo} apiTry\n\nUnknown endpoint id: ${id}` }] };
      }

      const env = readDotEnv(projectRoot);
      const domain = env["TRAEFIK_DOMAIN"] ?? "localhost";
      const subdomain = env["TRAEFIK_SUBDOMAIN"];
      const hostHeader = subdomain ? `${subdomain}.${domain}` : domain;
      const baseCurlUrl = `http://nginx`;

      // Build path with :param replacement
      let finalPath = endpoint.url;
      const usedParamNames: Set<string> = new Set();
      if (params) {
        finalPath = finalPath.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, p1: string) => {
          const val = params[p1];
          usedParamNames.add(p1);
          return val === undefined || val === null ? "" : encodeURIComponent(String(val));
        });
      }

      // Prepare curl args
      const curlArgs: string[] = ["curl", "-s", "-k", "-H", `Host: ${hostHeader}`];
      const method = methodOverride ?? (endpoint.httpMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE");
      if (method !== "GET") curlArgs.push("-X", method);
      curlArgs.push("-H", "Accept: application/json");

      // Authenticate if requested
      let authHeaders: string[] = [];
      if (authenticate) {
        let xmlContent: string | undefined;
        if (punchinXmlPath && fs.existsSync(punchinXmlPath)) {
          xmlContent = fs.readFileSync(punchinXmlPath, "utf8");
        }
        const cookieFile = authenticateReuse ? `/tmp/mcp-cookies-${hostHeader}.txt` : undefined;
        authHeaders = await punchinCookieArgs(baseCurlUrl, hostHeader, xmlContent, cookieFile);
      }
      curlArgs.push(...authHeaders);

      // Split remaining params into query/body
      const remaining: Record<string, unknown> = {};
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (!usedParamNames.has(k)) remaining[k] = v;
        }
      }

      if (method === "GET") {
        // Build query string supporting arrays as key[]
        const qParts: string[] = [];
        for (const [k, v] of Object.entries(remaining)) {
          if (Array.isArray(v)) {
            for (const item of v) qParts.push(`${encodeURIComponent(`${k}[]`)}=${encodeURIComponent(String(item))}`);
          } else if (typeof v === "object" && v !== null) {
            qParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify(v))}`);
          } else if (v !== undefined && v !== null) {
            qParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
          }
        }
        const qs = qParts.length > 0 ? `?${qParts.join("&")}` : "";
        curlArgs.push(`${baseCurlUrl}${finalPath}${qs}`);
      } else {
        // JSON body for non-GET
        curlArgs.push("-H", "Content-Type: application/json");
        curlArgs.push("-d", JSON.stringify(remaining));
        curlArgs.push(`${baseCurlUrl}${finalPath}`);
      }

      const res = await wardenExec(projectRoot, "php-fpm", curlArgs);
      const text = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} apiTry ${method} ${finalPath}\n\n${text.trim() || "(empty)"}`,
          },
        ],
      };
    }
  );

  server.tool(
    "magento.cacheClean",
    "Runs bin/magento cache:clean [types?] inside php-fpm",
    {
      types: z.array(z.string()).optional(),
    },
    async (args) => {
      const { types } = args as { types?: string[] };
      const magentoArgs: string[] = ["cache:clean"];
      if (types && types.length > 0) {
        magentoArgs.push(...types);
      }
      const res = await wardenMagento(projectRoot, magentoArgs);
      const rawOutput = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          { type: "text", text: `${projectInfo} Cache Clean\n\n${cleanOutput ?? "Cache cleaned successfully"}` },
        ],
      };
    }
  );

  // Generic authenticated REST/GraphQL caller
  server.tool(
    "magento.apiCall",
    "Call a REST or GraphQL endpoint with optional punchin auth",
    {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      path: z.string().describe("REST path starting with / or 'graphql' for GraphQL"),
      query: z.record(z.string(), z.string()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.record(z.string(), z.any()).optional(),
      graphqlQuery: z.string().optional(),
      authenticate: z.boolean().optional(),
      punchinXmlPath: z.string().optional().describe("Path to punchin XML on host; if provided, used per call"),
      authenticateReuse: z.boolean().optional().describe("Reuse a cached cookie for this host during session"),
    },
    async (args) => {
      const { method, path, query, headers, body, graphqlQuery, authenticate, punchinXmlPath, authenticateReuse } =
        args as {
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
      const domain = env["TRAEFIK_DOMAIN"] ?? "localhost";
      const subdomain = env["TRAEFIK_SUBDOMAIN"];
      const hostHeader = subdomain ? `${subdomain}.${domain}` : domain;
      const baseCurlUrl = `http://nginx`;

      let authHeaders: string[] = [];
      if (authenticate) {
        let xmlContent: string | undefined;
        if (punchinXmlPath && fs.existsSync(punchinXmlPath)) {
          xmlContent = fs.readFileSync(punchinXmlPath, "utf8");
        }
        const cookieFile = authenticateReuse ? `/tmp/mcp-cookies-${hostHeader}.txt` : undefined;
        authHeaders = await punchinCookieArgs(baseCurlUrl, hostHeader, xmlContent, cookieFile);
      }

      const curlArgs: string[] = ["curl", "-s", "-k", "-H", `Host: ${hostHeader}`];

      // Add headers
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          curlArgs.push("-H", `${k}: ${v}`);
        }
      }

      // Default Accept
      curlArgs.push("-H", "Accept: application/json");

      // Method
      if (method !== "GET") {
        curlArgs.push("-X", method);
      }

      // Body or GraphQL
      if (graphqlQuery) {
        curlArgs.push("-H", "Content-Type: application/json");
        curlArgs.push("-d", JSON.stringify({ query: graphqlQuery, variables: body ?? {} }));
      } else if (body) {
        curlArgs.push("-H", "Content-Type: application/json");
        curlArgs.push("-d", JSON.stringify(body));
      }

      // Auth cookies
      curlArgs.push(...authHeaders);

      // URL
      const q = query ? `?${new URLSearchParams(query).toString()}` : "";
      const finalPath = path === "graphql" ? "/graphql" : path.startsWith("/") ? path : `/${path}`;
      curlArgs.push(`${baseCurlUrl}${finalPath}${q}`);

      const res = await wardenExec(projectRoot, "php-fpm", curlArgs);
      const text = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;

      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} API Call ${method} ${finalPath}${q}\n\n${text.trim() || "(empty)"}`,
          },
        ],
      };
    }
  );

  server.tool(
    "magento.cacheFlush",
    "Runs bin/magento cache:flush [types?] inside php-fpm",
    {
      types: z.array(z.string()).optional(),
    },
    async (args) => {
      const { types } = args as { types?: string[] };
      const magentoArgs: string[] = ["cache:flush"];
      if (types && types.length > 0) {
        magentoArgs.push(...types);
      }
      const res = await wardenMagento(projectRoot, magentoArgs);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          { type: "text", text: `${projectInfo} Cache Flush\n\n${cleanOutput ?? "Cache flushed successfully"}` },
        ],
      };
    }
  );

  server.tool("magento.setupUpgrade", "Runs bin/magento setup:upgrade then cache:clean", {}, async () => {
    const up = await wardenMagento(projectRoot, ["setup:upgrade"]);
    const cc = await wardenMagento(projectRoot, ["cache:clean"]);
    const rawOutput = [up.stdout, cc.stdout, up.stderr, cc.stderr].filter(Boolean).join("\n");
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return {
      content: [
        {
          type: "text",
          text: `${projectInfo} Setup Upgrade\n\n${cleanOutput ?? "Setup upgrade completed successfully"}`,
        },
      ],
    };
  });

  server.tool("magento.diCompile", "Runs bin/magento setup:di:compile", {}, async () => {
    // Start the operation with extended timeout
    const startTime = Date.now();

    try {
      // Use a longer timeout for DI compile (20 minutes)
      const res = await wardenMagento(projectRoot, ["setup:di:compile"], ["-d", "memory_limit=-1"], 20 * 60_000);
      const duration = Math.round((Date.now() - startTime) / 1000);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);

      if (res.ok) {
        return {
          content: [
            {
              type: "text",
              text: `${projectInfo} DI Compile Completed (${duration}s)\n\n${cleanOutput ?? "DI compilation completed successfully"}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: "text", text: `${projectInfo} DI Compile Failed (${duration}s)\n\n${cleanOutput ?? res.stderr}` },
          ],
        };
      }
    } catch (error: unknown) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} DI Compile Error (${duration}s)\n\nOperation failed: ${errorMessage}`,
          },
        ],
      };
    }
  });

  server.tool(
    "magento.staticDeploy",
    "Runs bin/magento setup:static-content:deploy [options]",
    {
      languages: z.array(z.string()).optional(),
      area: z.enum(["adminhtml", "frontend"]).optional(),
      jobs: z.number().int().min(0).optional(),
      force: z.boolean().optional(),
    },
    async (args) => {
      const { languages, area, jobs, force } = args as {
        languages?: string[];
        area?: "adminhtml" | "frontend";
        jobs?: number;
        force?: boolean;
      };
      const magentoArgs: string[] = ["setup:static-content:deploy"];
      if (languages && languages.length > 0) {
        magentoArgs.push(...languages);
      }
      if (area) magentoArgs.push("--area", area);
      if (typeof jobs === "number") magentoArgs.push("--jobs", String(jobs));
      if (force) magentoArgs.push("--force");
      const res = await wardenMagento(projectRoot, magentoArgs);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} Static Deploy\n\n${cleanOutput ?? "Static content deployed successfully"}`,
          },
        ],
      };
    }
  );

  server.tool("magento.indexerReindex", "Runs bin/magento indexer:reindex", {}, async () => {
    const res = await wardenMagento(projectRoot, ["indexer:reindex"]);
    const rawOutput = res.ok ? res.stdout : res.stderr;
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return {
      content: [
        {
          type: "text",
          text: `${projectInfo} Indexer Reindex\n\n${cleanOutput ?? "Reindexing completed successfully"}`,
        },
      ],
    };
  });

  server.tool("magento.modeShow", "Shows Magento deploy mode", {}, async () => {
    const res = await wardenMagento(projectRoot, ["deploy:mode:show"]);
    const rawOutput = res.ok ? res.stdout : res.stderr;
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return {
      content: [
        { type: "text", text: `${projectInfo} Mode Show\n\n${cleanOutput ?? "Unable to determine deploy mode"}` },
      ],
    };
  });

  server.tool(
    "magento.modeSet",
    "Sets Magento deploy mode (developer|production)",
    {
      mode: z.enum(["developer", "production"]).describe("Deploy mode to set"),
    },
    async (args) => {
      const { mode } = args as { mode: "developer" | "production" };
      const res = await wardenMagento(projectRoot, ["deploy:mode:set", mode]);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} Mode Set\n\n${cleanOutput ?? `Deploy mode set to ${mode} successfully`}`,
          },
        ],
      };
    }
  );

  server.tool(
    "magento.configSet",
    "Sets a Magento config value: bin/magento config:set <path> <value>",
    {
      path: z.string(),
      value: z.string(),
    },
    async (args) => {
      const { path, value } = args as { path: string; value: string };
      const res = await wardenMagento(projectRoot, ["config:set", path, value]);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} Config Set\n\n${cleanOutput ?? `Configuration ${path} set successfully`}`,
          },
        ],
      };
    }
  );

  server.tool(
    "magento.configShow",
    "Shows a Magento config value: bin/magento config:show <path>",
    {
      path: z.string(),
    },
    async (args) => {
      const { path } = args as { path: string };
      const res = await wardenMagento(projectRoot, ["config:show", path]);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          { type: "text", text: `${projectInfo} Config Show\n\n${cleanOutput || `Configuration ${path} not found`}` },
        ],
      };
    }
  );

  server.tool(
    "magento.apiDiscover",
    "Discover available REST and GraphQL APIs in this Magento instance",
    {
      type: z.enum(["rest", "graphql", "both"]).optional().default("both"),
      format: z.enum(["summary", "detailed", "endpoints-only"]).optional().default("summary"),
      authenticate: z.boolean().optional().describe("Use punchin authentication for protected endpoints"),
      punchinXmlPath: z.string().optional().describe("Path to punchin XML on host; if provided, used per call"),
      authenticateReuse: z.boolean().optional().describe("Reuse a cached cookie for this host during session"),
    },
    async (args) => {
      const { type, format, authenticate, punchinXmlPath, authenticateReuse } = args as {
        type?: "rest" | "graphql" | "both";
        format?: "summary" | "detailed" | "endpoints-only";
        authenticate?: boolean;
        punchinXmlPath?: string;
        authenticateReuse?: boolean;
      };

      const env = readDotEnv(projectRoot);
      const domain = env["TRAEFIK_DOMAIN"] ?? "localhost";
      const subdomain = env["TRAEFIK_SUBDOMAIN"];
      const hostHeader = subdomain ? `${subdomain}.${domain}` : domain;
      // Use internal nginx endpoint with Host header for reliability
      const baseCurlUrl = `http://nginx`;
      const baseUrl = `https://${hostHeader}`;

      let output = `${projectInfo} API Discovery\n\n`;

      // Authentication setup if requested
      let authHeaders: string[] = [];
      if (authenticate) {
        try {
          output += "🔐 **Authenticating with punchin...**\n";
          let xmlContent: string | undefined;
          if (punchinXmlPath && fs.existsSync(punchinXmlPath)) {
            xmlContent = fs.readFileSync(punchinXmlPath, "utf8");
          }
          const cookieFile = authenticateReuse ? `/tmp/mcp-cookies-${hostHeader}.txt` : undefined;
          authHeaders = await punchinCookieArgs(baseCurlUrl, hostHeader, xmlContent, cookieFile);
          if (authHeaders.length > 0) output += "✅ **Authentication successful**\n\n";
          else output += "❌ Authentication failed (cookies not set)\n\n";
        } catch (error) {
          output += `❌ Authentication error: ${String(error)}\n\n`;
        }
      }

      if (type === "rest" || type === "both") {
        try {
          // Get REST API schema using curl
          const curlArgs = [
            "curl",
            "-s",
            "-k", // Allow insecure SSL for local development
            "-H",
            "Accept: application/json",
            "-H",
            `Host: ${hostHeader}`,
            ...authHeaders,
            `${baseCurlUrl}/rest/all/schema?services=all`,
          ];

          const schemaRes = await wardenExec(projectRoot, "php-fpm", curlArgs);

          if (schemaRes.ok && schemaRes.stdout.trim()) {
            try {
              const schema = JSON.parse(schemaRes.stdout) as {
                paths?: Record<string, Record<string, { summary?: string }>>;
              };
              const paths = schema.paths ?? {};
              const pathCount = Object.keys(paths).length;

              output += `🔗 **REST API Endpoints** (${pathCount} total)\n`;

              if (format === "summary") {
                // Group by prefix and show counts
                const prefixCounts: Record<string, number> = {};
                Object.keys(paths).forEach((path) => {
                  const prefix = path.split("/").slice(0, 3).join("/"); // e.g., /V1/products
                  prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;
                });

                Object.entries(prefixCounts)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .forEach(([prefix, count]) => {
                    output += `  ${prefix}* (${count} endpoints)\n`;
                  });
              } else if (format === "endpoints-only") {
                Object.keys(paths)
                  .sort()
                  .forEach((path) => {
                    const methods = Object.keys(paths[path]).join(", ").toUpperCase();
                    output += `  ${methods} ${path}\n`;
                  });
              } else {
                // detailed format
                Object.entries(paths)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .slice(0, 50) // Limit to first 50 for readability
                  .forEach(([path, pathData]) => {
                    const methods = Object.keys(pathData).join(", ").toUpperCase();
                    const firstMethod = Object.keys(pathData)[0];
                    const summary = firstMethod ? (pathData[firstMethod]?.summary ?? "") : "";
                    output += `  ${methods} ${path}\n`;
                    if (summary) output += `    ${summary}\n`;
                  });
                if (Object.keys(paths).length > 50) {
                  output += `  ... and ${Object.keys(paths).length - 50} more endpoints\n`;
                }
              }

              output += `\n📖 **Swagger UI**: ${baseUrl}/swagger\n`;
            } catch (parseError) {
              output += `❌ Failed to parse REST API schema: ${String(parseError)}\n`;
            }
          } else {
            output += `❌ Failed to fetch REST API schema\n`;
            if (schemaRes.stderr) output += `Error: ${schemaRes.stderr}\n`;
          }
        } catch (error) {
          output += `❌ Error fetching REST APIs: ${String(error)}\n`;
        }

        output += "\n";
      }

      if (type === "graphql" || type === "both") {
        try {
          // GraphQL introspection query
          const introspectionQuery = `
            query IntrospectionQuery {
              __schema {
                queryType { name }
                mutationType { name }
                subscriptionType { name }
                types {
                  ...FullType
                }
              }
            }
            fragment FullType on __Type {
              kind
              name
              description
              fields(includeDeprecated: true) {
                name
                description
                args {
                  ...InputValue
                }
                type {
                  ...TypeRef
                }
                isDeprecated
                deprecationReason
              }
            }
            fragment InputValue on __InputValue {
              name
              description
              type { ...TypeRef }
              defaultValue
            }
            fragment TypeRef on __Type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                  }
                }
              }
            }
          `;

          const curlArgs = [
            "curl",
            "-s",
            "-k",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-H",
            "Accept: application/json",
            "-H",
            `Host: ${hostHeader}`,
            ...authHeaders,
            "-d",
            JSON.stringify({ query: introspectionQuery }),
            `${baseCurlUrl}/graphql`,
          ];

          const gqlRes = await wardenExec(projectRoot, "php-fpm", curlArgs);

          if (gqlRes.ok && gqlRes.stdout.trim()) {
            try {
              const result = JSON.parse(gqlRes.stdout) as {
                data?: {
                  __schema?: {
                    queryType?: { name: string };
                    mutationType?: { name: string };
                    types: Array<{ name: string; fields?: Array<{ name: string; description?: string }> }>;
                  };
                };
              };

              const schema = result.data?.__schema;
              if (schema) {
                const queryType = schema.types.find((t) => t.name === schema.queryType?.name);
                const mutationType = schema.types.find((t) => t.name === schema.mutationType?.name);

                output += `🔍 **GraphQL Schema**\n`;

                if (queryType?.fields) {
                  output += `\n**Queries** (${queryType.fields.length} available):\n`;
                  if (format === "summary") {
                    const categories: Record<string, number> = {};
                    queryType.fields.forEach((field) => {
                      const category = field.name.replace(/([A-Z])/g, " $1").split(" ")[0] ?? "other";
                      categories[category] = (categories[category] ?? 0) + 1;
                    });
                    Object.entries(categories).forEach(([cat, count]) => {
                      output += `  ${cat}* (${count} queries)\n`;
                    });
                  } else {
                    queryType.fields.slice(0, 20).forEach((field) => {
                      output += `  ${field.name}`;
                      if (field.description && format === "detailed") {
                        output += ` - ${field.description}`;
                      }
                      output += "\n";
                    });
                    if (queryType.fields.length > 20) {
                      output += `  ... and ${queryType.fields.length - 20} more queries\n`;
                    }
                  }
                }

                if (mutationType?.fields) {
                  output += `\n**Mutations** (${mutationType.fields.length} available):\n`;
                  if (format === "summary") {
                    const categories: Record<string, number> = {};
                    mutationType.fields.forEach((field) => {
                      const category = field.name.replace(/([A-Z])/g, " $1").split(" ")[0] ?? "other";
                      categories[category] = (categories[category] ?? 0) + 1;
                    });
                    Object.entries(categories).forEach(([cat, count]) => {
                      output += `  ${cat}* (${count} mutations)\n`;
                    });
                  } else {
                    mutationType.fields.slice(0, 20).forEach((field) => {
                      output += `  ${field.name}`;
                      if (field.description && format === "detailed") {
                        output += ` - ${field.description}`;
                      }
                      output += "\n";
                    });
                    if (mutationType.fields.length > 20) {
                      output += `  ... and ${mutationType.fields.length - 20} more mutations\n`;
                    }
                  }
                }

                output += `\n🔍 **GraphQL Playground**: ${baseUrl}/graphql (use browser dev tools)\n`;
              } else {
                output += `❌ Invalid GraphQL schema response\n`;
              }
            } catch (parseError) {
              output += `❌ Failed to parse GraphQL schema: ${String(parseError)}\n`;
            }
          } else {
            output += `❌ Failed to fetch GraphQL schema\n`;
            if (gqlRes.stderr) output += `Error: ${gqlRes.stderr}\n`;
          }
        } catch (error) {
          output += `❌ Error fetching GraphQL schema: ${String(error)}\n`;
        }
      }

      // Add custom API discovery by scanning webapi.xml files
      try {
        const findArgs = ["find", "app/code", "-name", "webapi.xml", "-type", "f"];

        const findRes = await wardenExec(projectRoot, "php-fpm", findArgs);
        if (findRes.ok && findRes.stdout.trim()) {
          const webapiFiles = findRes.stdout.trim().split("\n");
          output += `\n📁 **Custom API Files Found**: ${webapiFiles.length} webapi.xml files\n`;

          if (format !== "summary") {
            webapiFiles.forEach((file) => {
              const modulePath = file.replace("/etc/webapi.xml", "").replace("app/code/", "");
              output += `  ${modulePath}\n`;
            });
          }
        }
      } catch {
        // Custom API discovery is optional, don't fail the whole operation
      }

      return {
        content: [
          {
            type: "text",
            text: output.trim(),
          },
        ],
      };
    }
  );
}
