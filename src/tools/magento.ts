import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wardenMagento, getProjectInfo } from "../lib/exec.js";

export function registerMagentoTools(server: McpServer, projectRoot: string) {
  const projectInfo = getProjectInfo(projectRoot);

  server.tool(
    "magento.cacheClean",
    "Runs bin/magento cache:clean [types?] inside php-fpm",
    {
      types: z.array(z.string()).optional(),
    },
    async (args) => {
      const { types } = args as { types?: string[] };
      const magentoArgs: string[] = ["cache:clean"];
      if (types && types.length > 0) {
        magentoArgs.push(...types);
      }
      const res = await wardenMagento(projectRoot, magentoArgs);
      const text = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;
      return { content: [{ type: "text", text: `${projectInfo} Cache Clean\n\n${text}` }] };
    }
  );

  server.tool(
    "magento.cacheFlush",
    "Runs bin/magento cache:flush [types?] inside php-fpm",
    {
      types: z.array(z.string()).optional(),
    },
    async (args) => {
      const { types } = args as { types?: string[] };
      const magentoArgs: string[] = ["cache:flush"];
      if (types && types.length > 0) {
        magentoArgs.push(...types);
      }
      const res = await wardenMagento(projectRoot, magentoArgs);
      return { content: [{ type: "text", text: `${projectInfo} Cache Flush\n\n${res.ok ? res.stdout : res.stderr}` }] };
    }
  );

  server.tool("magento.setupUpgrade", "Runs bin/magento setup:upgrade then cache:clean", {}, async () => {
    const up = await wardenMagento(projectRoot, ["setup:upgrade"]);
    const cc = await wardenMagento(projectRoot, ["cache:clean"]);
    const text = [up.stdout, cc.stdout, up.stderr, cc.stderr].filter(Boolean).join("\n");
    return { content: [{ type: "text", text: `${projectInfo} Setup Upgrade\n\n${text}` }] };
  });

  server.tool("magento.diCompile", "Runs bin/magento setup:di:compile", {}, async () => {
    const res = await wardenMagento(projectRoot, ["setup:di:compile"]);
    return { content: [{ type: "text", text: `${projectInfo} DI Compile\n\n${res.ok ? res.stdout : res.stderr}` }] };
  });

  server.tool(
    "magento.staticDeploy",
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
      const magentoArgs: string[] = ["setup:static-content:deploy"];
      if (languages && languages.length > 0) {
        magentoArgs.push(...languages);
      }
      if (area) magentoArgs.push("--area", area);
      if (typeof jobs === "number") magentoArgs.push("--jobs", String(jobs));
      if (force) magentoArgs.push("--force");
      const res = await wardenMagento(projectRoot, magentoArgs);
      return {
        content: [{ type: "text", text: `${projectInfo} Static Deploy\n\n${res.ok ? res.stdout : res.stderr}` }],
      };
    }
  );

  server.tool("magento.indexerReindex", "Runs bin/magento indexer:reindex", {}, async () => {
    const res = await wardenMagento(projectRoot, ["indexer:reindex"]);
    return {
      content: [{ type: "text", text: `${projectInfo} Indexer Reindex\n\n${res.ok ? res.stdout : res.stderr}` }],
    };
  });

  server.tool("magento.modeShow", "Shows Magento deploy mode", {}, async () => {
    const res = await wardenMagento(projectRoot, ["deploy:mode:show"]);
    return { content: [{ type: "text", text: `${projectInfo} Mode Show\n\n${res.ok ? res.stdout : res.stderr}` }] };
  });

  server.tool(
    "magento.modeSet",
    "Sets Magento deploy mode (developer|production)",
    {
      mode: z.enum(["developer", "production"]).describe("Deploy mode to set"),
    },
    async (args) => {
      const { mode } = args as { mode: "developer" | "production" };
      const res = await wardenMagento(projectRoot, ["deploy:mode:set", mode]);
      return { content: [{ type: "text", text: `${projectInfo} Mode Set\n\n${res.ok ? res.stdout : res.stderr}` }] };
    }
  );

  server.tool(
    "magento.configSet",
    "Sets a Magento config value: bin/magento config:set <path> <value>",
    {
      path: z.string(),
      value: z.string(),
    },
    async (args) => {
      const { path, value } = args as { path: string; value: string };
      const res = await wardenMagento(projectRoot, ["config:set", path, value]);
      return { content: [{ type: "text", text: `${projectInfo} Config Set\n\n${res.ok ? res.stdout : res.stderr}` }] };
    }
  );

  server.tool(
    "magento.configShow",
    "Shows a Magento config value: bin/magento config:show <path>",
    {
      path: z.string(),
    },
    async (args) => {
      const { path } = args as { path: string };
      const res = await wardenMagento(projectRoot, ["config:show", path]);
      return { content: [{ type: "text", text: `${projectInfo} Config Show\n\n${res.ok ? res.stdout : res.stderr}` }] };
    }
  );
}
