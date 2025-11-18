"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// src/cli/index.ts
const path = __importStar(require("path"));
const analyzer_1 = require("../core/analyzer");
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
    }
    else if (command === "analyze") {
        const componentName = args[1];
        if (!componentName) {
            console.error("Error: component name is required: compo analyze <ComponentName> --project <path>");
            process.exit(1);
        }
        runAnalyze(projectRoot, componentName);
    }
    else if (command === "tree") {
        const componentName = args[1];
        if (!componentName) {
            console.error("Error: component name is required: compo tree <ComponentName> --project <path>");
            process.exit(1);
        }
        runTree(projectRoot, componentName);
    }
    else {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
}
function runMap(projectRoot) {
    const result = (0, analyzer_1.analyzeProject)({ projectRoot });
    if (result.components.length === 0) {
        console.log("No React components detected.");
        return;
    }
    console.log(`Detected ${result.components.length} components:\n`);
    // Group by role
    const byRole = {};
    for (const comp of result.components) {
        const role = comp.role || "unknown";
        if (!byRole[role])
            byRole[role] = [];
        byRole[role].push(comp);
    }
    for (const role of Object.keys(byRole)) {
        console.log(role.toUpperCase());
        console.log("-----------------------");
        for (const comp of byRole[role]) {
            console.log(`- ${comp.name}  (${comp.filePath}, LOC: ${comp.loc}, hooks: [${comp.hooks.join(", ")}])`);
        }
        console.log("");
    }
}
function runAnalyze(projectRoot, componentName) {
    const result = (0, analyzer_1.analyzeProject)({ projectRoot });
    const matches = result.components.filter((c) => c.name === componentName);
    if (matches.length === 0) {
        console.log(`No component named "${componentName}" found.`);
        return;
    }
    if (matches.length > 1) {
        console.log(`Found ${matches.length} components named "${componentName}". Showing all:\n`);
    }
    for (const comp of matches) {
        printComponentDetails(comp);
        console.log("\n");
    }
}
function printComponentDetails(comp) {
    console.log(`Component: ${comp.name}`);
    console.log(`File:      ${comp.filePath}`);
    console.log(`Role:      ${comp.role}`);
    console.log(`LOC:       ${comp.loc}`);
    console.log(`Complexity:${comp.complexity}`);
    console.log("");
    console.log(`Props:`);
    console.log(comp.props.length ? "  - " + comp.props.join("\n  - ") : "  (none)");
    console.log("");
    console.log(`Hooks:`);
    console.log(comp.hooks.length ? "  - " + comp.hooks.join("\n  - ") : "  (none)");
    console.log("");
    console.log(`Children:`);
    console.log(comp.children.length ? "  - " + comp.children.join("\n  - ") : "  (none)");
}
// ------- TREE COMMAND --------
function runTree(projectRoot, componentName) {
    const result = (0, analyzer_1.analyzeProject)({ projectRoot });
    const { graph } = result;
    const node = graph[componentName];
    if (!node) {
        console.log(`No component named "${componentName}" found in graph.`);
        // small hint: show a few similar names
        const suggestions = Object.keys(graph).filter((name) => name.toLowerCase().includes(componentName.toLowerCase()));
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
    }
    else {
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
    const visited = new Set();
    const maxDepth = 2;
    for (const childName of node.children) {
        printChildrenSubtree(graph, childName, 1, maxDepth, visited);
    }
}
function printChildrenSubtree(graph, name, depth, maxDepth, visited) {
    const node = graph[name];
    const indent = "  ".repeat(depth);
    if (!node) {
        console.log(`${indent}- ${name} (not found in graph)`);
        return;
    }
    console.log(`${indent}- ${name} (LOC: ${node.info.loc}, role: ${node.info.role})`);
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
