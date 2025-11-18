// src/cli/index.ts
import * as path from "path";
import { analyzeProject } from "../core/analyzer";
import { ComponentInfo } from "../core/componentInfo";

function printHelp() {
  console.log(`
Component Archaeologist CLI

Usage:
  compo map --project <path>
  compo analyze <ComponentName> --project <path>
  compo tree <ComponentName> --project <path>

Commands:
  map       Analyze project and list detected components
  analyze   Show detailed info for a single component
  tree      Show parents and children tree for a component
  help      Show this message
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help") {
    printHelp();
    process.exit(0);
  }

  const projectIndex = args.indexOf("--project");
  if (projectIndex === -1 || !args[projectIndex + 1]) {
    console.error("Error: --project <path> is required");
    process.exit(1);
  }

  const projectRoot = path.resolve(process.cwd(), args[projectIndex + 1]);

  if (command === "map") {
    runMap(projectRoot);
  } else if (command === "analyze") {
    const componentName = args[1];
    if (!componentName) {
      console.error(
        "Error: component name is required: compo analyze <ComponentName> --project <path>"
      );
      process.exit(1);
    }
    runAnalyze(projectRoot, componentName);
  } else if (command === "tree") {
    const componentName = args[1];
    if (!componentName) {
      console.error(
        "Error: component name is required: compo tree <ComponentName> --project <path>"
      );
      process.exit(1);
    }
    runTree(projectRoot, componentName);
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

function runMap(projectRoot: string) {
  const result = analyzeProject({ projectRoot });

  if (result.components.length === 0) {
    console.log("No React components detected.");
    return;
  }

  console.log(`Detected ${result.components.length} components:\n`);

  // Group by role
  const byRole: Record<string, ComponentInfo[]> = {};
  for (const comp of result.components) {
    const role = comp.role || "unknown";
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(comp);
  }

  for (const role of Object.keys(byRole)) {
    console.log(role.toUpperCase());
    console.log("-----------------------");
    for (const comp of byRole[role]) {
      console.log(
        `- ${comp.name}  (${comp.filePath}, LOC: ${
          comp.loc
        }, hooks: [${comp.hooks.join(", ")}])`
      );
    }
    console.log("");
  }
}

function runAnalyze(projectRoot: string, componentName: string) {
  const result = analyzeProject({ projectRoot });

  const matches = result.components.filter((c) => c.name === componentName);

  if (matches.length === 0) {
    console.log(`No component named "${componentName}" found.`);
    return;
  }

  if (matches.length > 1) {
    console.log(
      `Found ${matches.length} components named "${componentName}". Showing all:\n`
    );
  }

  for (const comp of matches) {
    printComponentDetails(comp);
    console.log("\n");
  }
}

function printComponentDetails(comp: ComponentInfo) {
  console.log(`Component: ${comp.name}`);
  console.log(`File:      ${comp.filePath}`);
  console.log(`Role:      ${comp.role}`);
  console.log(`LOC:       ${comp.loc}`);
  console.log(`Complexity:${comp.complexity}`);
  console.log("");

  // --- Print Structural Chunks (Line Ranges) ---
  console.log(`Structure (1-based Line Ranges):`);
  const ranges = comp.lineRanges;

  if (ranges.state) {
    console.log(`  State:    ${ranges.state.start}-${ranges.state.end}`);
  } else {
    console.log(`  State:    (none detected)`);
  }

  if (ranges.effects.length) {
    console.log(
      `  Effects:  ${ranges.effects
        .map((r) => `${r.start}-${r.end}`)
        .join(", ")}`
    );
  } else {
    console.log(`  Effects:  (none detected)`);
  }

  if (ranges.handlers.length) {
    console.log(
      `  Handlers: ${ranges.handlers
        .map((r) => `${r.start}-${r.end}`)
        .join(", ")}`
    );
  } else {
    console.log(`  Handlers: (none detected)`);
  }

  if (ranges.jsx) {
    console.log(`  JSX:      ${ranges.jsx.start}-${ranges.jsx.end}`);
  } else {
    console.log(`  JSX:      (none detected)`);
  }
  console.log("");
  // ---------------------------------------------

  console.log(`Props:`);
  console.log(
    comp.props.length ? "  - " + comp.props.join("\n  - ") : "  (none)"
  );
  console.log("");

  console.log(`Hooks:`);
  console.log(
    comp.hooks.length ? "  - " + comp.hooks.join("\n  - ") : "  (none)"
  );
  console.log("");

  console.log(`Children:`);
  console.log(
    comp.children.length ? "  - " + comp.children.join("\n  - ") : "  (none)"
  );
}

// ------- TREE COMMAND --------
function runTree(projectRoot: string, componentName: string) {
  const result = analyzeProject({ projectRoot });
  const { graph } = result;

  const node = graph[componentName];

  if (!node) {
    console.log(`No component named "${componentName}" found in graph.`);
    // small hint: show a few similar names
    const suggestions = Object.keys(graph).filter((name) =>
      name.toLowerCase().includes(componentName.toLowerCase())
    );
    if (suggestions.length) {
      console.log("\nDid you mean:");
      for (const s of suggestions.slice(0, 10)) {
        console.log("  -", s);
      }
    }
    return;
  }

  console.log(`Component tree for: ${componentName}`);
  console.log(`File:  ${node.info.filePath}`);
  console.log(`Role:  ${node.info.role}`);
  console.log("");

  // Direct parents
  console.log("Direct parents (who renders this):");
  if (node.parents.length === 0) {
    console.log("  (no parents found - likely a top-level or entry component)");
  } else {
    for (const p of node.parents) {
      const pNode = graph[p];
      const loc = pNode?.info.loc ?? "?";
      console.log(`  - ${p} (LOC: ${loc})`);
    }
  }
  console.log("");

  // Children tree
  console.log("Children tree (who this component renders, depth <= 2):");
  if (node.children.length === 0) {
    console.log("  (no children components detected)");
    return;
  }

  const visited = new Set<string>();
  const maxDepth = 2;

  for (const childName of node.children) {
    printChildrenSubtree(graph, childName, 1, maxDepth, visited);
  }
}

type Graph = ReturnType<typeof analyzeProject>["graph"];

function printChildrenSubtree(
  graph: Graph,
  name: string,
  depth: number,
  maxDepth: number,
  visited: Set<string>
) {
  const node = graph[name];
  const indent = "  ".repeat(depth);

  if (!node) {
    console.log(`${indent}- ${name} (not found in graph)`);
    return;
  }

  console.log(
    `${indent}- ${name} (LOC: ${node.info.loc}, role: ${node.info.role})`
  );

  if (depth >= maxDepth) {
    return;
  }

  if (visited.has(name)) {
    console.log(`${indent}  (cycle detected, stopping here)`);
    return;
  }
  visited.add(name);

  for (const child of node.children) {
    printChildrenSubtree(graph, child, depth + 1, maxDepth, visited);
  }
}

main();
