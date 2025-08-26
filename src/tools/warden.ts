import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wardenExec, wardenLogsTail, getProjectInfo } from "../lib/exec.js";
import { readDotEnv, sanitizeEnv, isWardenProject } from "../lib/env.js";

interface DirentWithName extends fs.Dirent {
  name: string;
}

function defaultScanDirs(): string[] {
  const home = os.homedir();
  const envVar = process.env.MCP_WARDEN_SCAN_DIRS;
  if (envVar && envVar.trim().length > 0)
    return envVar
      .split(":")
      .map((s) => s.trim())
      .filter(Boolean);
  const candidates = [
    path.join(home, "Sites"),
    path.join(home, "Projects"),
    // Common macOS path when repos live under Documents/GitLab
    path.join(home, "Documents", "GitLab"),
  ];
  return candidates.filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
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

  server.tool(
    "warden.discoverProjects",
    "Scan directories for Warden projects (folders containing .env with WARDEN_ENV_NAME)",
    {
      scanDirs: z.array(z.string()).optional(),
    },
    (args) => {
      const { scanDirs } = args as { scanDirs?: string[] };
      const dirs = (scanDirs && scanDirs.length > 0 ? scanDirs : defaultScanDirs()).filter(
        (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory()
      );

      const found: { path: string; envName: string | null; traefik?: string }[] = [];
      for (const base of dirs) {
        const entries = fs.readdirSync(base, { withFileTypes: true }) as DirentWithName[];
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const p = path.join(base, e.name);
          const envPath = path.join(p, ".env");
          if (fs.existsSync(envPath) && isWardenProject(p)) {
            const env = readDotEnv(p);
            found.push({ path: p, envName: env["WARDEN_ENV_NAME"] ?? null, traefik: env["TRAEFIK_DOMAIN"] });
          }
        }
      }
      const text = found.length
        ? found
            .map((f) => `${f.path}  (env: ${f.envName ?? "?"}${f.traefik ? `, traefik: ${f.traefik}` : ""})`)
            .join("\n")
        : "No Warden projects found.";
      return { content: [{ type: "text", text: `Project Discovery\n\n${text}` }] };
    }
  );
}
