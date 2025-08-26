import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { isWardenProject } from "./env.js";

export type RunResult = { ok: boolean; code: number | null; stdout: string; stderr: string; durationMs: number };

export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 5 * 60_000,
  env?: NodeJS.ProcessEnv
): Promise<RunResult> {
  const start = Date.now();
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
        child.kill("SIGKILL");
      } catch {
        // Ignore errors when killing process
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      resolve({ ok: code === 0, code, stdout, stderr, durationMs });
    });
  });
}

export function assertWardenProject(projectRoot: string) {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) throw new Error(`.env not found in ${projectRoot}. Is this a Warden project?`);
  if (!isWardenProject(projectRoot)) throw new Error(`WARDEN_ENV_NAME missing in ${envPath}`);
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
