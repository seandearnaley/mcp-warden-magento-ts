import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wardenMagento, getProjectInfo, cleanMagentoOutput } from "../lib/exec.js";
import { createLogger } from "../lib/logger.js";

export function registerMagentoTools(server: McpServer, projectRoot: string) {
  const logger = createLogger("magento-tools");
  const projectInfo = getProjectInfo(projectRoot);

  logger.info(`Registering Magento tools for project: ${projectInfo}`);

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
      const rawOutput = res.ok ? res.stdout : `${res.stdout}\n${res.stderr}`;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          { type: "text", text: `${projectInfo} Cache Clean\n\n${cleanOutput || "Cache cleaned successfully"}` },
        ],
      };
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
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          { type: "text", text: `${projectInfo} Cache Flush\n\n${cleanOutput || "Cache flushed successfully"}` },
        ],
      };
    }
  );

  server.tool("magento.setupUpgrade", "Runs bin/magento setup:upgrade then cache:clean", {}, async () => {
    const up = await wardenMagento(projectRoot, ["setup:upgrade"]);
    const cc = await wardenMagento(projectRoot, ["cache:clean"]);
    const rawOutput = [up.stdout, cc.stdout, up.stderr, cc.stderr].filter(Boolean).join("\n");
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return {
      content: [
        {
          type: "text",
          text: `${projectInfo} Setup Upgrade\n\n${cleanOutput || "Setup upgrade completed successfully"}`,
        },
      ],
    };
  });

  server.tool("magento.diCompile", "Runs bin/magento setup:di:compile", {}, async () => {
    // Start the operation with extended timeout
    const startTime = Date.now();

    try {
      // Use a longer timeout for DI compile (20 minutes)
      const res = await wardenMagento(projectRoot, ["setup:di:compile"], ["-d", "memory_limit=-1"], 20 * 60_000);
      const duration = Math.round((Date.now() - startTime) / 1000);
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);

      if (res.ok) {
        return {
          content: [
            {
              type: "text",
              text: `${projectInfo} DI Compile Completed (${duration}s)\n\n${cleanOutput || "DI compilation completed successfully"}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: "text", text: `${projectInfo} DI Compile Failed (${duration}s)\n\n${cleanOutput || res.stderr}` },
          ],
        };
      }
    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} DI Compile Error (${duration}s)\n\nOperation failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
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
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} Static Deploy\n\n${cleanOutput || "Static content deployed successfully"}`,
          },
        ],
      };
    }
  );

  server.tool("magento.indexerReindex", "Runs bin/magento indexer:reindex", {}, async () => {
    const res = await wardenMagento(projectRoot, ["indexer:reindex"]);
    const rawOutput = res.ok ? res.stdout : res.stderr;
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return {
      content: [
        {
          type: "text",
          text: `${projectInfo} Indexer Reindex\n\n${cleanOutput || "Reindexing completed successfully"}`,
        },
      ],
    };
  });

  server.tool("magento.modeShow", "Shows Magento deploy mode", {}, async () => {
    const res = await wardenMagento(projectRoot, ["deploy:mode:show"]);
    const rawOutput = res.ok ? res.stdout : res.stderr;
    const cleanOutput = cleanMagentoOutput(rawOutput);
    return {
      content: [
        { type: "text", text: `${projectInfo} Mode Show\n\n${cleanOutput || "Unable to determine deploy mode"}` },
      ],
    };
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
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} Mode Set\n\n${cleanOutput || `Deploy mode set to ${mode} successfully`}`,
          },
        ],
      };
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
      const rawOutput = res.ok ? res.stdout : res.stderr;
      const cleanOutput = cleanMagentoOutput(rawOutput);
      return {
        content: [
          {
            type: "text",
            text: `${projectInfo} Config Set\n\n${cleanOutput || `Configuration ${path} set successfully`}`,
          },
        ],
      };
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
