import * as fs from "node:fs";
import * as path from "node:path";

export type DotEnv = Record<string, string>;

export function readDotEnv(projectRoot: string): DotEnv {
  const file = path.join(projectRoot, ".env");
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  const result: DotEnv = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

export function isWardenProject(projectRoot: string): boolean {
  const env = readDotEnv(projectRoot);
  return typeof env["WARDEN_ENV_NAME"] === "string" && env["WARDEN_ENV_NAME"].length > 0;
}

export function sanitizeEnv(env: DotEnv): DotEnv {
  const redactedKeys = [/SECRET/i, /PASSWORD/i, /TOKEN/i, /KEY/i];
  const out: DotEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (redactedKeys.some((rx) => rx.test(k))) out[k] = "***redacted***";
    else out[k] = v;
  }
  return out;
}
