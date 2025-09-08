import * as path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wardenExec, wardenLogsTail, getProjectInfo } from "../lib/exec.js";
import { readDotEnv, sanitizeEnv } from "../lib/env.js";

export function validateWardenExecInput(service: unknown, argv: unknown): { ok: boolean; reason?: string } {
  if (typeof service !== "string" || !/^[a-z0-9-]+$/i.test(service) || service.length === 0 || service.length > 32) {
    return { ok: false, reason: "invalid service name" };
  }
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 50) {
    return { ok: false, reason: "invalid argv" };
  }
  for (const a of argv) {
    if (typeof a !== "string" || a.length === 0 || a.length > 200 || /[\n\r\0]/.test(a)) {
      return { ok: false, reason: "invalid argv" };
    }
  }
  return { ok: true };
}

export function registerWardenTools(server: McpServer, projectRoot: string, shortPrefix?: string) {
  const projectInfo = getProjectInfo(projectRoot);
  const toolPrefix = shortPrefix ? `${shortPrefix}_` : "";

  const already = new Set<string>();
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
    `${toolPrefix}warden_exec`,
    "Run a command in a specific container (php-fpm, php-debug, varnish, redis, etc.)",
    {
      service: z.string().describe("Container service name"),
      argv: z.array(z.string()).describe("Command and args, e.g. ['bash','-lc','ls -la']"),
    },
    async (args) => {
      const { service, argv } = args as { service: string; argv: string[] };
      const validation = validateWardenExecInput(service, argv);
      if (!validation.ok) {
        return {
          content: [
            {
              type: "text",
              text: `${projectInfo} Exec Validation Error\n\nRequest rejected due to ${validation.reason}.`,
            },
          ],
        };
      }
      const res = await wardenExec(projectRoot, service, argv);
      const text = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;
      return { content: [{ type: "text", text: `${projectInfo} Exec [${service}] ${argv.join(" ")}\n\n${text}` }] };
    }
  );

  defineTool(`${toolPrefix}warden_varnishFlush`, "Varnish ban all: varnishadm 'ban req.url ~ .'", {}, async () => {
    const res = await wardenExec(projectRoot, "varnish", ["varnishadm", "ban", "req.url ~ ."]);
    return { content: [{ type: "text", text: `${projectInfo} Varnish Flush\n\n${res.ok ? res.stdout : res.stderr}` }] };
  });

  defineTool(`${toolPrefix}warden_redisFlushAll`, "Redis flushall (USE WITH CAUTION)", {}, async () => {
    const res = await wardenExec(projectRoot, "redis", ["redis-cli", "flushall"]);
    return {
      content: [{ type: "text", text: `${projectInfo} Redis Flush All\n\n${res.ok ? res.stdout : res.stderr}` }],
    };
  });

  defineTool(
    `${toolPrefix}warden_logsTail`,
    "Tail last N lines of logs for given services (no follow)",
    {
      services: z.array(z.string()).optional().default(["nginx", "php-fpm"]),
      tailLines: z.number().int().min(1).max(5000).optional().default(200),
    },
    async (args) => {
      const { services = ["nginx", "php-fpm"], tailLines = 200 } = args as { services?: string[]; tailLines?: number };
      const res = await wardenLogsTail(projectRoot, services, tailLines);
      return { content: [{ type: "text", text: `${projectInfo} Logs Tail\n\n${res.ok ? res.stdout : res.stderr}` }] };
    }
  );

  defineTool(`${toolPrefix}warden_showEnv`, "Read and return sanitized .env for a Warden project", {}, () => {
    const env = sanitizeEnv(readDotEnv(projectRoot));
    const lines = Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    return { content: [{ type: "text", text: `${projectInfo} .env\n\n${lines}` }] };
  });

  defineTool(`${toolPrefix}warden_projectInfo`, "Show information about the current Warden project", {}, () => {
    const env = readDotEnv(projectRoot);
    const projectName = path.basename(path.dirname(projectRoot));
    const envName = env["WARDEN_ENV_NAME"] ?? "unknown";
    const domain = env["TRAEFIK_DOMAIN"] ?? "localhost";
    const sub = env["TRAEFIK_SUBDOMAIN"] ? `${env["TRAEFIK_SUBDOMAIN"]}.` : "";
    const phpVersion = env["PHP_VERSION"] ?? "unknown";
    const text = `${projectInfo} Project Information\n\nProject: ${projectName}\nEnvironment: ${envName}\nDomain: ${sub}${domain}\nPHP Version: ${phpVersion}\nWarden Root: ${projectRoot}\nProject Root: ${path.dirname(projectRoot)}`;
    return { content: [{ type: "text", text }] };
  });

  defineTool(
    `${toolPrefix}warden_dbQuery`,
    "Run a safe, read-only SQL query in the db container",
    {
      sql: z.string().describe("SQL to execute (SELECT/SHOW/DESCRIBE/EXPLAIN only)"),
      database: z.string().optional().describe("Database name; defaults to MYSQL_DATABASE from .env"),
      output: z.enum(["table", "tsv", "csv", "raw"]).optional().default("table"),
    },
    async (args) => {
      const {
        sql,
        database,
        output = "table",
      } = args as { sql: string; database?: string; output?: "table" | "tsv" | "csv" | "raw" };
      const safe = /^(\s*)(select|show|describe|explain)\b/i.test(sql);
      if (!safe)
        return {
          content: [{ type: "text", text: `${projectInfo} DB Query\n\nOnly read-only statements are allowed.` }],
        };
      const env = readDotEnv(projectRoot);
      const dbName = database ?? env["MYSQL_DATABASE"] ?? "magento";
      const cmd = ["bash", "-lc", `mysql -h db -u root -proot ${dbName} -e ${JSON.stringify(sql)}`];
      const res = await wardenExec(projectRoot, "php-fpm", cmd);
      const txt = res.ok ? res.stdout : res.stderr;
      return { content: [{ type: "text", text: `${projectInfo} DB Query (${output})\n\n${txt}` }] };
    }
  );
}
