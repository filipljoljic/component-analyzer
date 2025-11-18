import * as path from "path";
import { analyzeProject } from "../core/analyzer";
import { ComponentInfo } from "../core/componentInfo";

function printHelp() {
  console.log(`
Component Archaeologist CLI

Usage:
  compo map --project <path>
  compo analyze <ComponentName> --project <path>

Commands:
  map       Analyze project and list detected components
  analyze   Show detailed info for a single component
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
        "Error: componenent name is required: compo analyze <ComponentName> --project <path>"
      );
      process.exit(1);
    }
    runAnalyze(projectRoot, componentName);
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

main();
