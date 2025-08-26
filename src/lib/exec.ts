import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { isWardenProject, readDotEnv } from "./env.js";
import { createLogger } from "./logger.js";

export type RunResult = { ok: boolean; code: number | null; stdout: string; stderr: string; durationMs: number };

export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 5 * 60_000,
  env?: NodeJS.ProcessEnv
): Promise<RunResult> {
  const logger = createLogger("exec");
  const start = Date.now();
  const command = `${cmd} ${args.join(" ")}`;

  logger.debug(`Executing command: ${command} in ${cwd}`);

  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, LANG: process.env.LANG ?? "C.UTF-8", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      try {
        logger.warn(`Command timed out after ${timeoutMs}ms: ${command}`);
        child.kill("SIGKILL");
      } catch {
        // Ignore errors when killing process
      }
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (code === 0) {
        logger.debug(`Command completed successfully in ${durationMs}ms: ${command}`);
      } else {
        logger.warn(`Command failed with code ${code} in ${durationMs}ms: ${command}`);
        if (stderr) {
          logger.debug(`Command stderr: ${stderr}`);
        }
      }

      resolve({ ok: code === 0, code, stdout, stderr, durationMs });
    });
  });
}

export function assertWardenProject(projectRoot: string) {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) throw new Error(`.env not found in ${projectRoot}. Is this a Warden project?`);
  if (!isWardenProject(projectRoot)) throw new Error(`WARDEN_ENV_NAME missing in ${envPath}`);
}

export function getProjectInfo(projectRoot: string): string {
  const env = readDotEnv(projectRoot);
  const envName = env["WARDEN_ENV_NAME"] || "unknown";
  const domain = env["TRAEFIK_DOMAIN"] || "";
  const projectName = path.basename(projectRoot);
  return `[${projectName}/${envName}${domain ? ` @ ${domain}` : ""}]`;
}

export function wardenMagento(
  projectRoot: string,
  magentoArgs: string[],
  phpFlags: string[] = ["-d", "memory_limit=-1"]
) {
  return run(
    "warden",
    ["env", "exec", "-T", "php-fpm", "php", ...phpFlags, "bin/magento", ...magentoArgs],
    projectRoot
  );
}

export function wardenExec(projectRoot: string, service: string, argv: string[]) {
  return run("warden", ["env", "exec", "-T", service, ...argv], projectRoot);
}

export async function wardenLogsTail(projectRoot: string, services: string[], tailLines = 200) {
  // Avoid -f follow which would hang the MCP call
  return await run("warden", ["env", "logs", "--tail", String(tailLines), ...services], projectRoot, 60_000);
}
