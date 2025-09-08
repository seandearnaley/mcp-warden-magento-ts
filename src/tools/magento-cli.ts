import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wardenMagento, cleanMagentoOutput, getProjectInfo, wardenExec } from "../lib/exec.js";

export function registerMagentoCliTools(server: McpServer, projectRoot: string, shortPrefix?: string) {
  const projectInfo = getProjectInfo(projectRoot);
  const toolPrefix = shortPrefix ? `${shortPrefix}_` : "";

  type ToolHandler = (args: Record<string, unknown>) =>
    | {
        content: Array<{ type: "text"; text: string; _meta?: Record<string, unknown> }>;
        _meta?: Record<string, unknown>;
      }
    | Promise<{
        content: Array<{ type: "text"; text: string; _meta?: Record<string, unknown> }>;
        _meta?: Record<string, unknown>;
      }>;

  const already = new Set<string>();
  function defineTool(
    name: string,
    description: string,
    schema: z.ZodRawShape | Record<string, unknown>,
    handler: ToolHandler
  ): void {
    if (already.has(name)) return;
    already.add(name);
    server.tool(name, description, schema as z.ZodRawShape, handler);
    if (process.env.NODE_ENV === "test") {
      let legacy = name;
      if (toolPrefix && legacy.startsWith(toolPrefix)) legacy = legacy.slice(toolPrefix.length);
      const usIdx = legacy.indexOf("_");
      if (usIdx > 0) {
        const dotted = `${legacy.slice(0, usIdx)}.${legacy.slice(usIdx + 1)}`;
        if (!already.has(dotted)) {
          already.add(dotted);
          server.tool(dotted, description, schema as z.ZodRawShape, handler);
        }
      }
    }
  }

  async function nukeFilesystem(): Promise<void> {
    const rm = "rm -rf pub/static/* var/view_preprocessed/* var/cache/* var/page_cache/* generated/*";
    await wardenExec(projectRoot, "php-fpm", ["sh", "-c", rm]);
  }

  defineTool(
    `${toolPrefix}magento_cacheClean`,
    "Runs bin/magento cache:clean [types?] inside php-fpm",
    {
      types: z.array(z.string()).optional(),
      nuke: z.boolean().optional().describe("Also remove filesystem caches and generated code"),
    },
    async (args) => {
      const { types, nuke } = args as { types?: string[]; nuke?: boolean };
      if (nuke) await nukeFilesystem();
      const cacheArgs = types && types.length > 0 ? ["cache:clean", ...types] : ["cache:clean"];
      const res = await wardenMagento(projectRoot, cacheArgs);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return { content: [{ type: "text", text: `${projectInfo} Cache Clean\n\n${cleanOutput}` }] };
    }
  );

  defineTool(
    `${toolPrefix}magento_cacheFlush`,
    "Runs bin/magento cache:flush [types?] inside php-fpm",
    {
      types: z.array(z.string()).optional(),
      nuke: z.boolean().optional().describe("Also remove filesystem caches and generated code"),
    },
    async (args) => {
      const { types, nuke } = args as { types?: string[]; nuke?: boolean };
      if (nuke) await nukeFilesystem();
      const cacheArgs = types && types.length > 0 ? ["cache:flush", ...types] : ["cache:flush"];
      const res = await wardenMagento(projectRoot, cacheArgs);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return { content: [{ type: "text", text: `${projectInfo} Cache Flush\n\n${cleanOutput}` }] };
    }
  );

  defineTool(
    `${toolPrefix}magento_setupUpgrade`,
    "Runs bin/magento setup:upgrade then cache:clean",
    {
      nuke: z.boolean().optional().describe("Also remove filesystem caches and generated code before upgrade"),
    },
    async (args) => {
      const { nuke } = (args ?? {}) as { nuke?: boolean };
      if (nuke) await nukeFilesystem();
      const up = await wardenMagento(projectRoot, ["setup:upgrade"]);
      const cc = await wardenMagento(projectRoot, ["cache:clean"]);
      const text = [up.stdout || up.stderr, cc.stdout || cc.stderr].filter(Boolean).join("\n\n");
      return { content: [{ type: "text", text: `${projectInfo} Setup Upgrade\n\n${text}` }] };
    }
  );

  defineTool(
    `${toolPrefix}magento_diCompile`,
    "Runs bin/magento setup:di:compile",
    { nuke: z.boolean().optional().describe("Also remove filesystem caches and generated code before compile") },
    async (args) => {
      const { nuke } = (args ?? {}) as { nuke?: boolean };
      if (nuke) await nukeFilesystem();
      const startTime = Date.now();
      try {
        const res = await wardenMagento(projectRoot, ["setup:di:compile"]);
        const duration = Date.now() - startTime;
        const rawOutput = res.ok ? res.stdout : res.stderr;
        const cleanOutput = cleanMagentoOutput(rawOutput);
        return { content: [{ type: "text", text: `${projectInfo} DI Compile (${duration}ms)\n\n${cleanOutput}` }] };
      } catch (e) {
        const duration = Date.now() - startTime;
        return {
          content: [{ type: "text", text: `${projectInfo} DI Compile Failed (${duration}ms)\n\n${String(e)}` }],
        };
      }
    }
  );

  defineTool(
    `${toolPrefix}magento_staticDeploy`,
    "Runs bin/magento setup:static-content:deploy [options]",
    {
      languages: z.array(z.string()).optional(),
      area: z.enum(["adminhtml", "frontend"]).optional(),
      jobs: z.number().int().min(0).optional(),
      force: z.boolean().optional(),
    },
    async (args) => {
      const { languages, area, jobs, force } = args as {
        languages?: string[];
        area?: "adminhtml" | "frontend";
        jobs?: number;
        force?: boolean;
      };
      const command = ["setup:static-content:deploy"];
      if (languages && languages.length > 0) command.push(...languages);
      if (area) command.push("-a", area);
      if (typeof jobs === "number") command.push("-j", String(jobs));
      if (force) command.push("-f");
      const res = await wardenMagento(projectRoot, command);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return { content: [{ type: "text", text: `${projectInfo} Static Deploy\n\n${cleanOutput}` }] };
    }
  );

  defineTool(`${toolPrefix}magento_indexerReindex`, "Runs bin/magento indexer:reindex", {}, async () => {
    const res = await wardenMagento(projectRoot, ["indexer:reindex"]);
    const rawOutput = res.ok ? res.stdout : res.stderr;
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return { content: [{ type: "text", text: `${projectInfo} Indexer Reindex\n\n${cleanOutput}` }] };
  });

  defineTool(`${toolPrefix}magento_modeShow`, "Shows Magento deploy mode", {}, async () => {
    const res = await wardenMagento(projectRoot, ["deploy:mode:show"]);
    const rawOutput = res.ok ? res.stdout : res.stderr;
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return { content: [{ type: "text", text: `${projectInfo} Deploy Mode\n\n${cleanOutput}` }] };
  });

  defineTool(
    `${toolPrefix}magento_modeSet`,
    "Sets Magento deploy mode (developer|production)",
    { mode: z.enum(["developer", "production"]).describe("Deploy mode to set") },
    async (args) => {
      const { mode } = args as { mode: "developer" | "production" };
      const res = await wardenMagento(projectRoot, ["deploy:mode:set", mode]);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return { content: [{ type: "text", text: `${projectInfo} Deploy Mode Set (${mode})\n\n${cleanOutput}` }] };
    }
  );

  defineTool(
    `${toolPrefix}magento_configSet`,
    "Sets a Magento config value: bin/magento config:set <path> <value>",
    { path: z.string(), value: z.string() },
    async (args) => {
      const { path, value } = args as { path: string; value: string };
      const res = await wardenMagento(projectRoot, ["config:set", path, value]);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return { content: [{ type: "text", text: `${projectInfo} Config Set\n\n${cleanOutput}` }] };
    }
  );

  defineTool(
    `${toolPrefix}magento_configShow`,
    "Shows a Magento config value: bin/magento config:show <path>",
    { path: z.string() },
    async (args) => {
      const { path } = args as { path: string };
      const res = await wardenMagento(projectRoot, ["config:show", path]);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          { type: "text", text: `${projectInfo} Config Show\n\n${cleanOutput || `Configuration ${path} not found`}` },
        ],
      };
    }
  );
}
