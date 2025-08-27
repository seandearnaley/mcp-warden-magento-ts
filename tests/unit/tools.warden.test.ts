import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerWardenTools } from "../../src/tools/warden.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../src/lib/exec.js", () => {
  return {
    wardenExec: vi.fn().mockResolvedValue({ ok: true, stdout: "EXEC_OK", stderr: "", code: 0, durationMs: 1 }),
    wardenLogsTail: vi.fn().mockResolvedValue({ ok: true, stdout: "LOGS", stderr: "", code: 0, durationMs: 1 }),
    getProjectInfo: vi.fn(() => "[proj]"),
  } as any;
});

vi.mock("../../src/lib/env.js", () => {
  return {
    readDotEnv: vi.fn(() => ({ WARDEN_ENV_NAME: "magento2", PUBLIC: "ok", PASSWORD: "secret" })),
    sanitizeEnv: vi.fn((e: any) => ({ ...e, PASSWORD: "***redacted***" })),
  } as any;
});

import * as execMock from "../../src/lib/exec.js";
import * as envMock from "../../src/lib/env.js";

type ToolReg = {
  name: string;
  description: string;
  schema: unknown;
  handler: (_args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

class FakeServer {
  tools: ToolReg[] = [];
  tool(name: string, description: string, _schema: unknown, handler: ToolReg["handler"]) {
    this.tools.push({ name, description, schema: _schema, handler });
  }
}

describe("registerWardenTools", () => {
  let server: FakeServer;

  beforeEach(() => {
    server = new FakeServer();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("warden.exec validates input and forwards to wardenExec", async () => {
    const typed = server as unknown as McpServer;
    registerWardenTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "warden.exec");
    expect(tool).toBeTruthy();

    // Invalid case
    const invalidRes = await tool!.handler({ service: "bad name", argv: ["ls"] });
    expect(invalidRes.content[0].text).toContain("Exec Validation Error");

    // Valid case
    const res = await tool!.handler({ service: "php-fpm", argv: ["php", "-v"] });
    expect(execMock.wardenExec).toHaveBeenCalledWith("/proj", "php-fpm", ["php", "-v"]);
    expect(res.content[0].text).toContain("[proj] Exec [php-fpm] php -v");
  });

  it("warden.logsTail forwards args to wardenLogsTail", async () => {
    const typed = server as unknown as McpServer;
    registerWardenTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "warden.logsTail");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({ services: ["nginx"], tailLines: 50 });
    expect(execMock.wardenLogsTail).toHaveBeenCalledWith("/proj", ["nginx"], 50);
    expect(res.content[0].text).toContain("Logs Tail");
  });

  it("warden.showEnv returns sanitized env", async () => {
    const typed = server as unknown as McpServer;
    registerWardenTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "warden.showEnv");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({});
    const txt = res.content[0].text;
    expect(envMock.readDotEnv).toHaveBeenCalled();
    expect(txt).toContain("PASSWORD=***redacted***");
    expect(txt).toContain("[proj]");
  });
});
