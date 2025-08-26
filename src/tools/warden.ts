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
}
