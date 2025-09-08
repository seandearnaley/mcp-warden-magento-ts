import { wardenExec, getProjectInfo } from "../lib/exec.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Shared endpoint types used by API documentation and apiTry tools
export type EndpointParam = {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
};

export type Endpoint = {
  id: string;
  url: string;
  httpMethod: string;
  auth: string;
  serviceClass: string;
  serviceMethod: string;
  module: string;
  params: EndpointParam[];
};

// Discover Magento webapi.xml routes and extract service/interface details
export async function discoverEndpoints(projectRoot: string): Promise<Endpoint[]> {
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
                /^(?:([a-zA-Z_\\\\][a-zA-Z0-9_\\\\]*)\s+)?\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*([^,]+))?$/.exec(
                  p.trim()
                );
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

export function getProjectBadge(projectRoot: string): string {
  return getProjectInfo(projectRoot);
}

// Utility for composing tool registration across modules
export type ToolRegistrar = (server: McpServer, projectRoot: string) => void | Promise<void>;

// Perform punchin auth using cXML and return curl cookie args usable with curl
export async function punchinCookieArgs(
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
