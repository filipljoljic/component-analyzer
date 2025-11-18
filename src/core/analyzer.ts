//src/core/analyzer.ts
import ts from "typescript";
import * as path from "path";
import { loadProject } from "./project";
import {
  ComponentInfo,
  ComponentRole,
  ComponentGraph,
  GraphNode,
} from "./componentInfo";
export interface AnalyzeOptions {
  projectRoot: string;
}

export interface AnalyzeResult {
  components: ComponentInfo[];
  graph: ComponentGraph;
}

/**
 * Main entry for analyzing a project.
 * For now: detect React components and return basic info.
 */
export function analyzeProject(options: AnalyzeOptions): AnalyzeResult {
  const { projectRoot } = options;
  const { sourceFiles, program } = loadProject(projectRoot);

  const components: ComponentInfo[] = [];

  for (const sf of sourceFiles) {
    if (sf.isDeclarationFile) continue;
    const filePath = sf.fileName;
    if (isTestFile(filePath)) continue;

    ts.forEachChild(sf, (node) => {
      const comp = detectComponentInNode(node, sf, program, filePath);
      if (comp) {
        components.push(comp);
      }
    });
  }

  const graph = buildGraph(components);

  return { components, graph };
}

/**
 * Ignore test files by default.
 */
function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes("/tests/") ||
    lower.includes("__mocks__") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".test.jsx") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.tsx")
  );
}

function detectComponentInNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  program: ts.Program,
  filePath: string
): ComponentInfo | null {
  // 1) function declaration: function MyComponent(props) { return <div /> }
  if (ts.isFunctionDeclaration(node) && node.name) {
    const name = node.name.text;
    if (isPascalCase(name) && containsJsx(node)) {
      return buildComponentInfoFromFunction(name, node, sourceFile, filePath);
    }
  }

  // 2) const MyComponent = (props) => { return <div /> }
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      if (!isPascalCase(name)) continue;

      const initializer = decl.initializer;
      if (
        initializer &&
        (ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer)) &&
        containsJsx(initializer)
      ) {
        return buildComponentInfoFromFunction(
          name,
          initializer,
          sourceFile,
          filePath
        );
      }
    }
  }

  return null;
}

function buildComponentInfoFromFunction(
  name: string,
  func: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): ComponentInfo {
  // ✅ explicitly pass sourceFile to avoid the getSourceFileOfNode(undefined) issue
  const startPos = func.getStart(sourceFile);
  const endPos = func.getEnd();

  const { line: startLine } =
    sourceFile.getLineAndCharacterOfPosition(startPos);
  const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(endPos);

  const loc = endLine - startLine + 1;

  const props: string[] = extractPropNames(func, sourceFile);
  const hooks: string[] = [];
  const children: string[] = [];

  if (func.body) {
    ts.forEachChild(func.body, (node) => {
      collectHooks(node, sourceFile, hooks);
      collectChildren(node, sourceFile, children);
    });
  }

  const complexity = 0;

  const lineRanges: ComponentInfo["lineRanges"] = {
    state: null,
    effects: [],
    handlers: [],
    jsx: null,
  };

  const role: ComponentRole = inferRoleFromPath(filePath);

  return {
    name,
    filePath: path.relative(process.cwd(), filePath),
    role,
    props,
    hooks,
    children: Array.from(new Set(children)),
    loc,
    complexity,
    lineRanges,
  };
}

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function containsJsx(
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
): boolean {
  let hasJsx = false;
  if (!node.body) return false;

  function visit(n: ts.Node) {
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      hasJsx = true;
      return;
    }
    ts.forEachChild(n, visit);
  }

  ts.forEachChild(node.body, visit);
  return hasJsx;
}

function extractPropNames(
  func: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile
): string[] {
  if (!func.parameters.length) return [];

  const firstParam = func.parameters[0].name;

  const names: string[] = [];

  if (ts.isObjectBindingPattern(firstParam)) {
    for (const el of firstParam.elements) {
      if (ts.isIdentifier(el.name)) {
        names.push(el.name.text);
      }
    }
  } else if (ts.isIdentifier(firstParam)) {
    // function MyComp(props) { ... } -> just "props"
    names.push(firstParam.text);
  }

  return names;
}

function collectHooks(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  hooks: string[]
) {
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) {
      const name = expr.text;
      if (name.startsWith("use")) {
        hooks.push(name);
      }
    }
  }
  ts.forEachChild(node, (child) => collectHooks(child, sourceFile, hooks));
}

function collectChildren(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  children: string[]
) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName;
    if (ts.isIdentifier(tag)) {
      const tagName = tag.text;
      // Heuristic: components are Capitalized, DOM elements are lowercase
      if (/^[A-Z]/.test(tagName)) {
        children.push(tagName);
      }
    }
  }
  ts.forEachChild(node, (child) =>
    collectChildren(child, sourceFile, children)
  );
}

// Very simple path-based role inference for now
function inferRoleFromPath(filePath: string): ComponentRole {
  const lower = filePath.toLowerCase();
  if (lower.includes("/pages/")) return "page";
  if (lower.includes("/features/")) return "feature";
  if (
    lower.includes("/components/") ||
    lower.includes("/shared/") ||
    lower.includes("/ui/")
  )
    return "shared";
  return "unknown";
}

function buildGraph(components: ComponentInfo[]): ComponentGraph {
  const graph: ComponentGraph = {};

  // 1) create nodes
  for (const comp of components) {
    if (!graph[comp.name]) {
      graph[comp.name] = {
        info: comp,
        parents: [],
        children: [],
      };
    } else {
      // ⚠️ simple behavior for duplicate names:
      // keep the first one as "info", but we could handle this better later
    }
  }

  // 2) connect edges based on children names
  for (const comp of components) {
    const parentNode = graph[comp.name];
    if (!parentNode) continue;

    for (const childName of comp.children) {
      const childNode = graph[childName];
      if (childNode) {
        parentNode.children.push(childName);
        if (!childNode.parents.includes(comp.name)) {
          childNode.parents.push(comp.name);
        }
      }
    }
  }

  return graph;
}
