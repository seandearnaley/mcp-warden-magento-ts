import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

// Minimal e2e: ensure server boots with a valid warden root and stays alive
// We skip if the built entrypoint doesn't exist to avoid coupling e2e to build.
test("server starts with valid --warden-root and can be terminated", async () => {
  const entry = path.join(process.cwd(), "dist", "index.js");
  test.skip(!fs.existsSync(entry), "dist/index.js not found; build before running e2e");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-warden-"));
  const project = path.join(tmp, "proj");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, ".env"), "WARDEN_ENV_NAME=magento2\nTRAEFIK_DOMAIN=example.test\n");

  // Start server
  const child = spawn(process.execPath, [entry, "--warden-root", project], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const startedPromise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 300);
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    // Resolve after small delay regardless; we only care that it doesn't exit immediately
    timer.unref?.();
  });

  // Wait briefly, then terminate
  await startedPromise;
  expect(child.pid).toBeTruthy();

  // Ensure process is still running before killing
  const exitedQuickly = await new Promise<boolean>((resolve) => {
    let resolved = false;
    child.once("exit", () => {
      resolved = true;
      resolve(true);
    });
    setTimeout(() => !resolved && resolve(false), 200);
  });
  expect(exitedQuickly).toBe(false);

  child.kill("SIGTERM");
});
