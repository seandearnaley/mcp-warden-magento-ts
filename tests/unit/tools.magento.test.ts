import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerMagentoTools } from "../../src/tools/magento.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock exec helpers used by Magento tools
vi.mock("../../src/lib/exec.js", () => {
  return {
    wardenMagento: vi.fn().mockResolvedValue({ ok: true, stdout: "OK", stderr: "", code: 0, durationMs: 1 }),
    getProjectInfo: vi.fn(() => "[proj]"),
    cleanMagentoOutput: (s: string) => s.trim(),
  } as any;
});

import * as execMock from "../../src/lib/exec.js";

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

describe("registerMagentoTools", () => {
  let server: FakeServer;

  beforeEach(() => {
    server = new FakeServer();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers cacheClean and calls wardenMagento with types", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.cacheClean");
    expect(tool).toBeTruthy();
    await tool!.handler({ types: ["config", "layout"] });
    expect(execMock.wardenMagento).toHaveBeenCalledWith("/proj", ["cache:clean", "config", "layout"]);
  });

  it("staticDeploy forwards options", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.staticDeploy");
    expect(tool).toBeTruthy();
    await tool!.handler({ languages: ["en_US"], area: "adminhtml", jobs: 4, force: true });
    expect(execMock.wardenMagento).toHaveBeenCalledWith("/proj", [
      "setup:static-content:deploy",
      "en_US",
      "--area",
      "adminhtml",
      "--jobs",
      "4",
      "--force",
    ]);
  });

  it("modeSet validates and passes mode", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.modeSet");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({ mode: "developer" });
    expect(execMock.wardenMagento).toHaveBeenCalledWith("/proj", ["deploy:mode:set", "developer"]);
    expect(res.content[0].text).toContain("[proj]");
  });

  it("cacheFlush forwards types when provided", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.cacheFlush");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({ types: ["config"] });
    expect(execMock.wardenMagento).toHaveBeenCalledWith("/proj", ["cache:flush", "config"]);
    expect(res.content[0].text).toContain("Cache Flush");
  });

  it("setupUpgrade runs setup:upgrade then cache:clean", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.setupUpgrade");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({});
    expect(execMock.wardenMagento).toHaveBeenNthCalledWith(1, "/proj", ["setup:upgrade"]);
    expect(execMock.wardenMagento).toHaveBeenNthCalledWith(2, "/proj", ["cache:clean"]);
    expect(res.content[0].text).toContain("Setup Upgrade");
  });

  it("diCompile passes php flags and long timeout (success)", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.diCompile");
    expect(tool).toBeTruthy();
    // Ensure next call resolves ok
    (execMock.wardenMagento as any).mockResolvedValueOnce({
      ok: true,
      stdout: "OK",
      stderr: "",
      code: 0,
      durationMs: 1,
    });
    const res = await tool!.handler({});
    expect(execMock.wardenMagento).toHaveBeenCalledWith(
      "/proj",
      ["setup:di:compile"],
      ["-d", "memory_limit=-1"],
      20 * 60_000
    );
    expect(res.content[0].text).toContain("DI Compile Completed");
  });

  it("diCompile reports failure with clean output", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.diCompile");
    expect(tool).toBeTruthy();
    (execMock.wardenMagento as any).mockResolvedValueOnce({
      ok: false,
      stdout: "",
      stderr: "ERR",
      code: 1,
      durationMs: 1,
    });
    const res = await tool!.handler({});
    expect(res.content[0].text).toContain("DI Compile Failed");
    expect(res.content[0].text).toContain("[proj]");
  });

  it("indexerReindex calls correct magento command", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.indexerReindex");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({});
    expect(execMock.wardenMagento).toHaveBeenCalledWith("/proj", ["indexer:reindex"]);
    expect(res.content[0].text).toContain("Indexer Reindex");
  });

  it("modeShow calls deploy:mode:show", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.modeShow");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({});
    expect(execMock.wardenMagento).toHaveBeenCalledWith("/proj", ["deploy:mode:show"]);
    expect(res.content[0].text).toContain("Mode Show");
  });

  it("configShow passes path param through", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.configShow");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({ path: "web/seo/use_rewrites" });
    expect(execMock.wardenMagento).toHaveBeenCalledWith("/proj", ["config:show", "web/seo/use_rewrites"]);
    expect(res.content[0].text).toContain("Config Show");
  });
});
