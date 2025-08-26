import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertWardenProject, wardenMagento } from "../lib/exec.js";

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
    async ({ projectRoot, types }) => {
      assertWardenProject(projectRoot);
      const res = await wardenMagento(projectRoot, ["cache:clean", ...(types ?? [])]);
      const text = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "magento.cacheFlush",
    "Runs bin/magento cache:flush [types?] inside php-fpm",
    {
      ...projectSchema,
      types: z.array(z.string()).optional(),
    },
    async ({ projectRoot, types }) => {
      assertWardenProject(projectRoot);
      const res = await wardenMagento(projectRoot, ["cache:flush", ...(types ?? [])]);
      return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
    }
  );

  server.tool(
    "magento.setupUpgrade",
    "Runs bin/magento setup:upgrade then cache:clean",
    projectSchema,
    async ({ projectRoot }) => {
      assertWardenProject(projectRoot);
      const up = await wardenMagento(projectRoot, ["setup:upgrade"]);
      const cc = await wardenMagento(projectRoot, ["cache:clean"]);
      const text = [up.stdout, cc.stdout, up.stderr, cc.stderr].filter(Boolean).join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool("magento.diCompile", "Runs bin/magento setup:di:compile", projectSchema, async ({ projectRoot }) => {
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
    async ({ projectRoot, languages, area, jobs, force }) => {
      assertWardenProject(projectRoot);
      const args = ["setup:static-content:deploy"];
      if (languages?.length) args.push(...languages);
      if (area) args.push("--area", area);
      if (typeof jobs === "number") args.push("--jobs", String(jobs));
      if (force) args.push("--force");
      const res = await wardenMagento(projectRoot, args);
      return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
    }
  );

  server.tool("magento.indexerReindex", "Runs bin/magento indexer:reindex", projectSchema, async ({ projectRoot }) => {
    assertWardenProject(projectRoot);
    const res = await wardenMagento(projectRoot, ["indexer:reindex"]);
    return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
  });

  server.tool("magento.modeShow", "Shows Magento deploy mode", projectSchema, async ({ projectRoot }) => {
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
    async ({ projectRoot, mode }) => {
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
    async ({ projectRoot, path, value }) => {
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
    async ({ projectRoot, path }) => {
      assertWardenProject(projectRoot);
      const res = await wardenMagento(projectRoot, ["config:show", path]);
      return { content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }] };
    }
  );
}
