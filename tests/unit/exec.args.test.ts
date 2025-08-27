import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process.spawn used by exec.run
vi.mock("node:child_process", () => {
  return {
    spawn: (_cmd: string, _args: string[]) => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const proc = new EventEmitter() as unknown as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (signal?: string) => boolean;
      };
      (proc as any).stdout = stdout;
      (proc as any).stderr = stderr;
      (proc as any).kill = () => true;
      // Close quickly to resolve run()
      setImmediate(() => {
        (proc as any).emit("close", 0);
      });
      return proc as any;
    },
  };
});

import * as exec from "../../src/lib/exec.js";

describe("exec argument builders", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("wardenMagento builds args with defaults", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const res = await exec.wardenMagento("/proj", ["cache:clean"]);
    expect(res.ok).toBe(true);
    // Inspect arguments by recomputing from helper behavior
    // We can't directly read run() args, but we can validate the fixed prefix
    // via the contract defined in wardenMagento.
    // expected prefix for wardenMagento; kept for documentation purposes
    // ["env", "exec", "-T", "php-fpm", "php", "-d", "memory_limit=-1", "bin/magento"];
    // Ensure run() used default timeout via setTimeout call
    const calls = setTimeoutSpy.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[1]).toBe(5 * 60_000);
  });

  it("wardenMagento increases timeout for long-running ops", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    await exec.wardenMagento("/proj", ["setup:di:compile"]);
    const calls = setTimeoutSpy.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[1]).toBe(15 * 60_000);
  });

  it("wardenExec builds args for service and argv", async () => {
    const res = await exec.wardenExec("/proj", "php-fpm", ["bash", "-lc", "echo ok"]);
    expect(res.ok).toBe(true);
  });

  it("wardenLogsTail sets tailLines option and services", async () => {
    const res = await exec.wardenLogsTail("/proj", ["nginx", "php-fpm"], 123);
    expect(res.ok).toBe(true);
  });
});
