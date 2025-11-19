// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { analyzeProject } from "../core/analyzer";
import { scoreComponentForRefactor } from "../core/refactorRadar";

function getProjectRootFromArgs(args: any): string {
  // Smithery / MCP should give us { projectRoot: "..." }
  // but we defensively support a couple of names
  const root =
    args?.projectRoot ??
    args?.path ?? // just in case some client uses "path"
    args?.project_root; // snake_case variant

  if (!root) {
    throw new Error(
      "Missing 'projectRoot' (or 'path') argument when calling MCP tool."
    );
  }

  return String(root);
}

// Build the MCP server with all tools
function createMcpServer() {
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
      const projectRoot = getProjectRootFromArgs(args);
      const componentName: string = String(args.componentName);

      // ✅ correct usage now
      const result: any = (analyzeProject as any)({ projectRoot });
      const graph = result.graph;
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
        const [s, e] = [lr.state.start, lr.state.end];
        summaryLines.push(`  State:    ${s}-${e}`);
      } else {
        summaryLines.push("  State:    (none)");
      }

      if (lr?.effects?.length) {
        summaryLines.push(
          `  Effects:  ${lr.effects
            .map((r: any) => `${r.start}-${r.end}`)
            .join(", ")}`
        );
      } else {
        summaryLines.push("  Effects:  (none)");
      }

      if (lr?.handlers?.length) {
        summaryLines.push(
          `  Handlers: ${lr.handlers
            .map((r: any) => `${r.start}-${r.end}`)
            .join(", ")}`
        );
      } else {
        summaryLines.push("  Handlers: (none)");
      }

      if (lr?.jsx) {
        const [s, e] = [lr.jsx.start, lr.jsx.end];
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
      description: "List all components grouped by role with refactor hotspots",
      inputSchema: {
        projectRoot: z
          .string()
          .describe(
            "Path to the React project root (e.g. ../finetica/finetica/client)"
          ),
      },
    } as any,
    async (args: any) => {
      const projectRoot = getProjectRootFromArgs(args);

      const result: any = (analyzeProject as any)({ projectRoot });
      const graph = result.graph;

      const lines: string[] = [];
      const byRole: Record<string, string[]> = {};
      const hotspots: string[] = [];

      for (const key of Object.keys(graph)) {
        const node = graph[key];
        const info = node.info;
        const role = info.role || "unknown";

        const score = scoreComponentForRefactor(info);

        // Emoji badge based on severity
        let badge = "";
        if (score.severity === "warning") badge = " ⚠️";
        if (score.severity === "critical") badge = " 🔥";

        // Short reasons for inline display
        const shortReasons = score.signals.map((s) => s.reason).join(", ");

        const extraMeta =
          score.severity === "none" || !shortReasons
            ? ""
            : `, refactor: ${shortReasons}`;

        const line = `${badge}- ${info.name}  (${info.filePath}, LOC: ${
          info.loc
        }, hooks: [${info.hooks.join(", ")}]${extraMeta})`;

        if (!byRole[role]) byRole[role] = [];
        byRole[role].push(line);

        // Collect separate hotspot list
        if (score.severity === "warning" || score.severity === "critical") {
          const details = score.signals.map((s) => s.details).join("; ");
          hotspots.push(
            `${badge} ${info.name}  → ${details}  [${info.loc} LOC, ${info.hooks.length} hooks, ${info.children.length} children]`
          );
        }
      }

      // 1) Hotspots section at the top
      if (hotspots.length) {
        lines.push("REFACTOR HOTSPOTS");
        lines.push("=================");
        lines.push(
          "These components are likely candidates for refactoring (large, complex, or very stateful):"
        );
        lines.push("");
        lines.push(...hotspots);
        lines.push("");
      }

      // 2) Role-grouped listing (with badges inline)
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
      const projectRoot = getProjectRootFromArgs(args);
      const componentName: string = String(args.componentName);

      const result: any = (analyzeProject as any)({ projectRoot });
      const graph = result.graph;
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

/**
 * This is the **required default export** for Smithery shttp builds.
 *
 * They call this function and expect it to return an McpServer instance.
 * We ignore `config` for now, but you can later use it to e.g. configure
 * default projectRoot, aliases, etc.
 */
export default function createServer(_opts: {
  config: unknown;
  sessionId?: string;
}) {
  return createMcpServer();
}
