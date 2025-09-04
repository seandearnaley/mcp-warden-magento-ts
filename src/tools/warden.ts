import * as path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wardenExec, wardenLogsTail, getProjectInfo, run } from "../lib/exec.js";
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

export function registerWardenTools(server: McpServer, projectRoot: string) {
  const projectInfo = getProjectInfo(projectRoot);

  server.tool(
    "warden.exec",
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

  server.tool("warden.varnishFlush", "Varnish ban all: varnishadm 'ban req.url ~ .'", {}, async () => {
    const res = await wardenExec(projectRoot, "varnish", ["varnishadm", "ban", "req.url ~ ."]);
    return { content: [{ type: "text", text: `${projectInfo} Varnish Flush\n\n${res.ok ? res.stdout : res.stderr}` }] };
  });

  server.tool("warden.redisFlushAll", "Redis flushall (USE WITH CAUTION)", {}, async () => {
    const res = await wardenExec(projectRoot, "redis", ["redis-cli", "flushall"]);
    return {
      content: [{ type: "text", text: `${projectInfo} Redis Flush All\n\n${res.ok ? res.stdout : res.stderr}` }],
    };
  });

  server.tool(
    "warden.logsTail",
    "Tail last N lines of logs for given services (no follow)",
    {
      services: z.array(z.string()).default(["nginx", "php-fpm"]),
      tailLines: z.number().int().min(1).max(5000).default(200),
    },
    async (args) => {
      const { services, tailLines } = args as {
        services: string[];
        tailLines: number;
      };
      const res = await wardenLogsTail(projectRoot, services, tailLines);
      return { content: [{ type: "text", text: `${projectInfo} Logs Tail\n\n${res.ok ? res.stdout : res.stderr}` }] };
    }
  );

  server.tool("warden.showEnv", "Read and return sanitized .env for a Warden project", {}, () => {
    const env = sanitizeEnv(readDotEnv(projectRoot));
    const lines = Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    return { content: [{ type: "text", text: `${projectInfo} Environment\n\n${lines || "(empty)"}` }] };
  });

  server.tool("warden.projectInfo", "Show information about the current Warden project", {}, () => {
    const env = readDotEnv(projectRoot);
    const projectName = path.basename(path.dirname(projectRoot));
    const envName = env["WARDEN_ENV_NAME"] || "unknown";
    const domain = env["TRAEFIK_DOMAIN"] || "not set";
    const phpVersion = env["PHP_VERSION"] || "not set";

    const info = [
      `Project: ${projectName}`,
      `Environment: ${envName}`,
      `Domain: ${domain}`,
      `PHP Version: ${phpVersion}`,
      `Warden Root: ${projectRoot}`,
      `Project Root: ${path.dirname(projectRoot)}`,
    ].join("\n");

    return { content: [{ type: "text", text: `${projectInfo} Project Information\n\n${info}` }] };
  });

  // Execute READ-ONLY SQL queries via the db container
  server.tool(
    "warden.dbQuery",
    "Run a safe, read-only SQL query in the db container",
    {
      sql: z.string().describe("SQL to execute (SELECT/SHOW/DESCRIBE/EXPLAIN only)"),
      database: z.string().optional().describe("Database name; defaults to MYSQL_DATABASE from .env"),
      output: z
        .enum(["table", "tsv", "csv", "raw"]) // table is human readable; tsv/csv/raw for tooling
        .optional()
        .default("table"),
    },
    async (args) => {
      const { sql, database, output } = args as {
        sql: string;
        database?: string;
        output?: "table" | "tsv" | "csv" | "raw";
      };

      // Simple read-only enforcement
      const sanitized = sql
        .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
        .replace(/--[^\n]*$/gm, " ") // line comments -- ...
        .replace(/#[^\n]*$/gm, " ") // hash comments
        .trim();

      const statements = sanitized
        .split(/;+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const mutatingRegex = new RegExp(
        String.raw`\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|RENAME|REPLACE|GRANT|REVOKE|SET\s+(?!SESSION\s+transaction_read_only)|CALL|LOAD\s+DATA|INTO\s+OUTFILE)\b`,
        "i"
      );
      for (const stmt of statements) {
        // Allow only SELECT/SHOW/DESCRIBE/EXPLAIN and read-only SET SESSION transaction_read_only
        const isAllowed =
          /^(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i.test(stmt) ||
          /^SET\s+SESSION\s+transaction_read_only\s*=\s*(ON|1)\s*$/i.test(stmt);
        if (!isAllowed || mutatingRegex.test(stmt)) {
          return {
            content: [
              {
                type: "text",
                text: `${projectInfo} DB Query Rejected\n\nOnly read-only queries are allowed. Disallowed statement: ${stmt}`,
              },
            ],
          };
        }
      }

      // Mirror `warden db connect` usage and pass flags through to mysql
      // warden db connect automatically connects to the default database
      const mysqlArgs: string[] = ["db", "connect", "--default-character-set=utf8mb4"];

      // Only specify database if explicitly requested (override default)
      if (database) {
        mysqlArgs.push("-D", database);
      }

      switch (output) {
        case "table":
          mysqlArgs.push("-t");
          break;
        case "tsv":
          mysqlArgs.push("-B"); // batch = tab-separated
          break;
        case "csv":
          mysqlArgs.push("-B");
          break;
        case "raw":
          mysqlArgs.push("-N", "-B", "-r"); // no headers, tab-separated, raw
          break;
        default:
          mysqlArgs.push("-t");
      }

      mysqlArgs.push("-e", sanitized);

      // Run via `warden db connect` so credentials are handled by Warden
      const res = await run("warden", mysqlArgs, projectRoot);
      let raw = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;

      if (output === "csv") {
        // Convert MySQL -B tab-separated output to CSV (best-effort)
        const lines = raw.split(/\r?\n/);
        raw = lines
          .map((line) =>
            line
              .split("\t")
              .map((field) => {
                if (field.includes('"') || field.includes(",") || field.includes("\n")) {
                  return `"${field.replace(/"/g, '""')}"`;
                }
                return field;
              })
              .join(",")
          )
          .join("\n");
      }

      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} DB Query (${output ?? "table"})\n\n${raw.trim() || "(no rows)"}`,
          },
        ],
      };
    }
  );
}
