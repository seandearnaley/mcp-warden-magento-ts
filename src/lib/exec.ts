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
  phpFlags: string[] = ["-d", "memory_limit=-1"],
  timeoutMs?: number
) {
  // Set longer timeouts for operations that can take a while
  const defaultTimeout = 5 * 60_000; // 5 minutes
  let operationTimeout = timeoutMs || defaultTimeout;
  
  // Increase timeout for known long-running operations
  const longRunningOps = ['setup:di:compile', 'setup:static-content:deploy', 'setup:upgrade', 'indexer:reindex'];
  if (longRunningOps.some(op => magentoArgs.includes(op))) {
    operationTimeout = 15 * 60_000; // 15 minutes for long operations
  }
  
  return run(
    "warden",
    ["env", "exec", "-T", "php-fpm", "php", ...phpFlags, "bin/magento", ...magentoArgs],
    projectRoot,
    operationTimeout
  );
}

// Helper function to clean up Magento CLI output
export function cleanMagentoOutput(output: string): string {
  if (!output) return output;
  
  // Split into lines and filter out debug noise
  const lines = output.split('\n');
  const cleanLines = lines.filter(line => {
    const trimmed = line.trim();
    // Filter out debug logs, empty lines, and other noise
    return trimmed && 
           !trimmed.startsWith('[') && // Remove timestamp logs like [2025-08-26 03:24:36]
           !trimmed.includes('main.DEBUG:') && // Remove debug logs
           !trimmed.includes('cache_invalidate:') && // Remove cache invalidation logs
           !trimmed.includes('{"method":"GET"') && // Remove JSON debug info
           !trimmed.startsWith('[]'); // Remove empty array logs
  });
  
  return cleanLines.join('\n').trim();
}

export function wardenExec(projectRoot: string, service: string, argv: string[]) {
  return run("warden", ["env", "exec", "-T", service, ...argv], projectRoot);
}

export async function wardenLogsTail(projectRoot: string, services: string[], tailLines = 200) {
  // Avoid -f follow which would hang the MCP call
  return await run("warden", ["env", "logs", "--tail", String(tailLines), ...services], projectRoot, 60_000);
}
