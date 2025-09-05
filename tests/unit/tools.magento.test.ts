import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerMagentoTools } from "../../src/tools/magento.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock exec helpers used by Magento tools
vi.mock("../../src/lib/exec.js", () => {
  const wardenMagento = vi.fn().mockResolvedValue({ ok: true, stdout: "OK", stderr: "", code: 0, durationMs: 1 });

  const wardenExec = vi.fn((_projectRoot: string, _service: string, argv: string[]) => {
    const joined = argv.join(" ");
    // Simulate discovery of one webapi.xml
    if (argv[0] === "find" && argv.includes("webapi.xml")) {
      return Promise.resolve({
        ok: true,
        code: 0,
        stdout: "app/code/Foo/Bar/etc/webapi.xml\n",
        stderr: "",
        durationMs: 1,
      });
    }
    // Read webapi.xml contents
    if (joined.includes("cat app/code/Foo/Bar/etc/webapi.xml")) {
      const xml = `<?xml version="1.0"?>\n<routes>\n  <route url="/V1/test/:id" method="GET">\n    <service class="Foo\\Bar\\Api\\TestInterface" method="getById"/>\n    <resources>\n      <resource ref="anonymous"/>\n    </resources>\n  </route>\n</routes>`;
      return Promise.resolve({ ok: true, code: 0, stdout: xml, stderr: "", durationMs: 1 });
    }
    // Read interface signature
    if (joined.includes("cat app/code/Foo/Bar/Api/TestInterface.php")) {
      const php = `<?php\nnamespace Foo\\Bar\\Api;\ninterface TestInterface {\n  /** Get by id */\n  public function getById(string $id, int $size = 10);\n}`;
      return Promise.resolve({ ok: true, code: 0, stdout: php, stderr: "", durationMs: 1 });
    }
    // Curl calls (apiTry/apiCall)
    if (argv[0] === "curl") {
      return Promise.resolve({ ok: true, code: 0, stdout: '{"ok":true}', stderr: "", durationMs: 1 });
    }
    // Default noop
    return Promise.resolve({ ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 });
  });

  return {
    wardenMagento,
    wardenExec,
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

  it("apiDocs summary lists totals and modules", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.apiDocs");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({ format: "summary" });
    const text = res.content[0].text;
    expect(text).toContain("API Catalog");
    expect(text).toContain("Total endpoints: 1");
    expect(text).toContain("Foo/Bar: 1");
  });

  it("apiDocs endpoints-only paginates", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.apiDocs");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({ format: "endpoints-only", limit: 1, offset: 0 });
    const text = res.content[0].text;
    expect(text).toContain("Endpoints 1-1 of 1");
    expect(text).toContain("GET /V1/test/");
  });

  it("apiDocsEndpoint returns endpoint details with params", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.apiDocsEndpoint");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({ id: "Foo\\Bar\\Api\\TestInterface.getById" });
    const text = res.content[0].text;
    expect(text).toContain("Endpoint");
    expect(text).toContain("ID: Foo\\Bar\\Api\\TestInterface.getById");
    expect(text).toContain("Method: GET");
    expect(text).toContain("Path: /V1/test/:id");
    expect(text).toContain("Params:");
    expect(text).toContain("id: string");
    expect(text).toContain("size: int (optional) = 10");
  });

  it("apiTry builds curl and returns output", async () => {
    const typed = server as unknown as McpServer;
    registerMagentoTools(typed, "/proj");
    const tool = server.tools.find((t) => t.name === "magento.apiTry");
    expect(tool).toBeTruthy();
    const res = await tool!.handler({
      id: "Foo\\Bar\\Api\\TestInterface.getById",
      params: { id: "A-1", size: 3, extra: "x" },
      methodOverride: "GET",
    });
    const text = res.content[0].text;
    expect(text).toContain("apiTry GET /V1/test/A-1");
    expect(text).toContain('{"ok":true}');
  });
});
