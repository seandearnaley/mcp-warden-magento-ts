import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverEndpoints, getProjectBadge } from "./magento-helpers.js";
import { readDotEnv } from "../lib/env.js";
import { wardenExec } from "../lib/exec.js";
import * as fs from "node:fs";

async function punchinCookieArgs(
  projectRoot: string,
  baseCurlUrl: string,
  hostHeader: string,
  punchinXmlContent?: string,
  cookiePath?: string
): Promise<string[]> {
  let punchinRes: { ok: boolean; stdout: string; stderr: string };
  const cookieFile = cookiePath ?? `/tmp/mcp-cookies-${hostHeader}.txt`;
  if (punchinXmlContent) {
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

export function registerApiTryTool(server: McpServer, projectRoot: string) {
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

      const endpoints = await discoverEndpoints(projectRoot);
      const endpoint = endpoints.find((e) => e.id === id);
      if (!endpoint) {
        return {
          content: [{ type: "text", text: `${getProjectBadge(projectRoot)} apiTry\n\nUnknown endpoint id: ${id}` }],
        };
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
        authHeaders = await punchinCookieArgs(projectRoot, baseCurlUrl, hostHeader, xmlContent, cookieFile);
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
            text: `${getProjectBadge(projectRoot)} apiTry ${method} ${finalPath}\n\n${text.trim() || "(empty)"}`,
          },
        ],
      };
    }
  );
}
