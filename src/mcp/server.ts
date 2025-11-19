// src/mcp/server.ts
import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { analyzeProject } from "../core/analyzer";

function getServer() {
  const server = new McpServer({
    name: "component-archaeologist",
    version: "0.1.0",
  });

  //
  // ===== Tool 1: compo_analyze =====
  //
  (server as any).registerTool(
    "compo_analyze",
    {
      title: "Analyze React component",
      description:
        "Show props, hooks, structure and children for a single component",
      inputSchema: {
        projectRoot: z
          .string()
          .describe(
            "Path to the React project root (e.g. ../finetica/finetica/client)"
          ),
        componentName: z
          .string()
          .describe("Name of the component to analyze (e.g. Users)"),
      },
    } as any,
    async (args: any) => {
      const projectRoot: string = String(args.projectRoot);
      const componentName: string = String(args.componentName);

      // ignore TypeScript’s opinion about this signature
      const graph: any = (analyzeProject as any)(projectRoot);
      const node = graph[componentName];

      if (!node) {
        return {
          content: [
            {
              type: "text",
              text: `Component "${componentName}" not found in project ${projectRoot}`,
            },
          ],
          isError: true,
        };
      }

      const { info, parents, children } = node;
      const summaryLines: string[] = [];

      summaryLines.push(`Component: ${info.name}`);
      summaryLines.push(`File: ${info.filePath}`);
      summaryLines.push(`Role: ${info.role}`);
      summaryLines.push(`LOC: ${info.loc}`);
      summaryLines.push(`Complexity: ${info.complexity}`);
      summaryLines.push("");

      summaryLines.push("Structure (1-based line ranges):");
      const lr: any = info.lineRanges;

      if (lr?.state) {
        const [s, e] = lr.state;
        summaryLines.push(`  State:    ${s}-${e}`);
      } else {
        summaryLines.push("  State:    (none)");
      }

      if (lr?.effects?.length) {
        summaryLines.push(
          `  Effects:  ${lr.effects
            .map(([s, e]: [number, number]) => `${s}-${e}`)
            .join(", ")}`
        );
      } else {
        summaryLines.push("  Effects:  (none)");
      }

      if (lr?.handlers?.length) {
        summaryLines.push(
          `  Handlers: ${lr.handlers
            .map(([s, e]: [number, number]) => `${s}-${e}`)
            .join(", ")}`
        );
      } else {
        summaryLines.push("  Handlers: (none)");
      }

      if (lr?.jsx) {
        const [s, e] = lr.jsx;
        summaryLines.push(`  JSX:      ${s}-${e}`);
      } else {
        summaryLines.push("  JSX:      (none)");
      }

      summaryLines.push("");

      if (info.props?.length) {
        summaryLines.push("Props:");
        info.props.forEach((p: string) => summaryLines.push(`  - ${p}`));
        summaryLines.push("");
      } else {
        summaryLines.push("Props: (none)");
        summaryLines.push("");
      }

      if (info.hooks?.length) {
        const hookCounts = (info.hooks as string[]).reduce<
          Record<string, number>
        >((acc, h) => {
          acc[h] = (acc[h] || 0) + 1;
          return acc;
        }, {});
        summaryLines.push("Hooks (with counts):");
        Object.entries(hookCounts).forEach(([name, count]) =>
          summaryLines.push(`  - ${name} (${count})`)
        );
        summaryLines.push("");
      } else {
        summaryLines.push("Hooks: (none)");
        summaryLines.push("");
      }

      summaryLines.push("Children:");
      if (children?.length) {
        children.forEach((c: string) => summaryLines.push(`  - ${c}`));
      } else {
        summaryLines.push("  (none)");
      }
      summaryLines.push("");
      summaryLines.push("Parents:");
      if (parents?.length) {
        parents.forEach((p: string) => summaryLines.push(`  - ${p}`));
      } else {
        summaryLines.push("  (none)");
      }

      return {
        content: [
          {
            type: "text",
            text: summaryLines.join("\n"),
          },
        ],
      };
    }
  );

  //
  // ===== Tool 2: compo_map =====
  //
  (server as any).registerTool(
    "compo_map",
    {
      title: "Map all components",
      description: "List all components grouped by role",
      inputSchema: {
        projectRoot: z
          .string()
          .describe(
            "Path to the React project root (e.g. ../finetica/finetica/client)"
          ),
      },
    } as any,
    async (args: any) => {
      const projectRoot: string = String(args.projectRoot);
      const graph: any = (analyzeProject as any)(projectRoot);

      const lines: string[] = [];
      const byRole: Record<string, string[]> = {};

      for (const key of Object.keys(graph)) {
        const node = graph[key];
        const info = node.info;
        const role = info.role || "unknown";
        if (!byRole[role]) byRole[role] = [];
        byRole[role].push(
          `- ${info.name}  (${info.filePath}, LOC: ${
            info.loc
          }, hooks: [${info.hooks.join(", ")}])`
        );
      }

      for (const role of Object.keys(byRole).sort()) {
        lines.push(role.toUpperCase());
        lines.push("-----------------------");
        lines.push(...byRole[role]);
        lines.push("");
      }

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    }
  );

  //
  // ===== Tool 3: compo_tree =====
  //
  (server as any).registerTool(
    "compo_tree",
    {
      title: "Show component tree",
      description:
        "Show parents and children for a component (one level up and down)",
      inputSchema: {
        projectRoot: z
          .string()
          .describe(
            "Path to the React project root (e.g. ../finetica/finetica/client)"
          ),
        componentName: z.string().describe("Name of the component to inspect"),
      },
    } as any,
    async (args: any) => {
      const projectRoot: string = String(args.projectRoot);
      const componentName: string = String(args.componentName);

      const graph: any = (analyzeProject as any)(projectRoot);
      const node = graph[componentName];

      if (!node) {
        return {
          content: [
            {
              type: "text",
              text: `Component "${componentName}" not found`,
            },
          ],
          isError: true,
        };
      }

      const { parents, children } = node;
      const lines: string[] = [];

      lines.push(`Tree for: ${componentName}`);
      lines.push("");
      lines.push("Parents:");
      if (parents?.length) {
        parents.forEach((p: string) => lines.push(`  - ${p}`));
      } else {
        lines.push("  (none)");
      }
      lines.push("");
      lines.push("Children:");
      if (children?.length) {
        children.forEach((c: string) => lines.push(`  - ${c}`));
      } else {
        lines.push("  (none)");
      }

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    }
  );

  return server;
}

// ---------- HTTP wiring for Smithery / local ----------
const app = express();
app.use(express.json());

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const server = getServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

const PORT = Number(process.env.PORT ?? "3000");
app.listen(PORT, () => {
  console.log(`Component Archaeologist MCP listening on port ${PORT}`);
});
