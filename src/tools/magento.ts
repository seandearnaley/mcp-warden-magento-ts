import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertWardenProject, wardenMagento, getProjectInfo } from "../lib/exec.js";

const projectSchema = {
  projectRoot: z.string().describe("Absolute path to the Warden project root (directory containing .env)"),
};

export function registerMagentoTools(server: McpServer) {
  server.tool(
    "magento.cacheClean",
    "Runs bin/magento cache:clean [types?] inside php-fpm",
    {
      ...projectSchema,
      types: z.array(z.string()).optional(),
    },
    async (args) => {
      const { projectRoot, types } = args as { projectRoot: string; types?: string[] };
      assertWardenProject(projectRoot);
      const projectInfo = getProjectInfo(projectRoot);
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
      ...projectSchema,
      types: z.array(z.string()).optional(),
    },
    async (args) => {
      const { projectRoot, types } = args as { projectRoot: string; types?: string[] };
      assertWardenProject(projectRoot);
      const projectInfo = getProjectInfo(projectRoot);
      const magentoArgs: string[] = ["cache:flush"];
      if (types && types.length > 0) {
        magentoArgs.push(...types);
      }
      const res = await wardenMagento(projectRoot, magentoArgs);
      return { content: [{ type: "text", text: `${projectInfo} Cache Flush\n\n${res.ok ? res.stdout : res.stderr}` }] };
    }
  );

  server.tool(
    "magento.setupUpgrade",
    "Runs bin/magento setup:upgrade then cache:clean",
    projectSchema,
    async (args) => {
      const { projectRoot } = args as { projectRoot: string };
      assertWardenProject(projectRoot);
      const projectInfo = getProjectInfo(projectRoot);
      const up = await wardenMagento(projectRoot, ["setup:upgrade"]);
      const cc = await wardenMagento(projectRoot, ["cache:clean"]);
      const text = [up.stdout, cc.stdout, up.stderr, cc.stderr].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: `${projectInfo} Setup Upgrade\n\n${text}` }] };
    }
  );

  server.tool("magento.diCompile", "Runs bin/magento setup:di:compile", projectSchema, async (args) => {
    const { projectRoot } = args as { projectRoot: string };
    assertWardenProject(projectRoot);
    const res = await wardenMagento(projectRoot, ["setup:di:compile"]);
    return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
  });

  server.tool(
    "magento.staticDeploy",
    "Runs bin/magento setup:static-content:deploy [options]",
    {
      ...projectSchema,
      languages: z.array(z.string()).optional(),
      area: z.enum(["adminhtml", "frontend"]).optional(),
      jobs: z.number().int().min(0).optional(),
      force: z.boolean().optional(),
    },
    async (args) => {
      const { projectRoot, languages, area, jobs, force } = args as {
        projectRoot: string;
        languages?: string[];
        area?: "adminhtml" | "frontend";
        jobs?: number;
        force?: boolean;
      };
      assertWardenProject(projectRoot);
      const magentoArgs: string[] = ["setup:static-content:deploy"];
      if (languages && languages.length > 0) {
        magentoArgs.push(...languages);
      }
      if (area) magentoArgs.push("--area", area);
      if (typeof jobs === "number") magentoArgs.push("--jobs", String(jobs));
      if (force) magentoArgs.push("--force");
      const res = await wardenMagento(projectRoot, magentoArgs);
      return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
    }
  );

  server.tool("magento.indexerReindex", "Runs bin/magento indexer:reindex", projectSchema, async (args) => {
    const { projectRoot } = args as { projectRoot: string };
    assertWardenProject(projectRoot);
    const res = await wardenMagento(projectRoot, ["indexer:reindex"]);
    return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
  });

  server.tool("magento.modeShow", "Shows Magento deploy mode", projectSchema, async (args) => {
    const { projectRoot } = args as { projectRoot: string };
    assertWardenProject(projectRoot);
    const res = await wardenMagento(projectRoot, ["deploy:mode:show"]);
    return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
  });

  server.tool(
    "magento.modeSet",
    "Sets Magento deploy mode (developer|production)",
    {
      ...projectSchema,
      mode: z.enum(["developer", "production"]).describe("Deploy mode to set"),
    },
    async (args) => {
      const { projectRoot, mode } = args as { projectRoot: string; mode: "developer" | "production" };
      assertWardenProject(projectRoot);
      const res = await wardenMagento(projectRoot, ["deploy:mode:set", mode]);
      return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
    }
  );

  server.tool(
    "magento.configSet",
    "Sets a Magento config value: bin/magento config:set <path> <value>",
    {
      ...projectSchema,
      path: z.string(),
      value: z.string(),
    },
    async (args) => {
      const { projectRoot, path, value } = args as { projectRoot: string; path: string; value: string };
      assertWardenProject(projectRoot);
      const res = await wardenMagento(projectRoot, ["config:set", path, value]);
      return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
    }
  );

  server.tool(
    "magento.configShow",
    "Shows a Magento config value: bin/magento config:show <path>",
    {
      ...projectSchema,
      path: z.string(),
    },
    async (args) => {
      const { projectRoot, path } = args as { projectRoot: string; path: string };
      assertWardenProject(projectRoot);
      const res = await wardenMagento(projectRoot, ["config:show", path]);
      return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
    }
  );
}
