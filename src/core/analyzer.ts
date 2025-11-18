//src/core/analyzer.ts
import ts from "typescript";
import * as path from "path";
import { loadProject } from "./project";
import {
  ComponentInfo,
  ComponentRole,
  ComponentGraph,
  GraphNode,
  LineRange,
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

  const props: string[] = extractPropNames(func);
  const hooks: string[] = [];
  const children: string[] = [];

  if (func.body) {
    collectHooks(func.body, hooks);
    collectChildren(func.body, children);
  }
  const uniqueHooks = Array.from(new Set(hooks));
  const uniqueChildren = Array.from(new Set(children));

  const complexity = 0;

  const lineRanges: ComponentInfo["lineRanges"] = {
    state: null,
    effects: [],
    handlers: [],
    jsx: null,
  };

  collectStructuralRanges(func, sourceFile, lineRanges);
  const role: ComponentRole = inferRoleFromPath(filePath);

  return {
    name,
    filePath: path.relative(process.cwd(), filePath),
    role,
    props,
    hooks: uniqueHooks,
    children: uniqueChildren,
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
  func: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
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

function collectHooks(node: ts.Node, hooks: string[]) {
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) {
      const name = expr.text;
      if (name.startsWith("use")) {
        hooks.push(name);
      }
    }
  }
  ts.forEachChild(node, (child) => collectHooks(child, hooks));
}

function collectChildren(node: ts.Node, children: string[]) {
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
  ts.forEachChild(node, (child) => collectChildren(child, children));
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

function getLineRange(node: ts.Node, sourceFile: ts.SourceFile): LineRange {
  const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile, false)
  );
  const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(
    node.getEnd()
  );
  // Convert 0-based index to 1-based line number
  return { start: startLine + 1, end: endLine + 1 };
}

function collectStructuralRanges(
  func: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
  lineRanges: ComponentInfo["lineRanges"]
) {
  // If the function has no body (e.g., it's an interface definition), stop.
  if (!func.body) return;

  // We only care about statements inside the function body's block
  const block = ts.isBlock(func.body) ? func.body.statements : [func.body];

  for (const statement of block) {
    // 1. STATE (useState, useReducer calls)
    if (ts.isVariableStatement(statement)) {
      const decl = statement.declarationList.declarations[0];
      const initializer = decl?.initializer;

      if (
        decl &&
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text.startsWith("use") &&
        (initializer.expression.text.endsWith("State") ||
          initializer.expression.text.endsWith("Reducer"))
      ) {
        // If we find the first useState/useReducer, this marks the state block
        const currentRange = getLineRange(statement, sourceFile);
        if (lineRanges.state === null) {
          lineRanges.state = currentRange;
        } else {
          // Extend existing block
          lineRanges.state.end = currentRange.end;
        }
      }
    }

    // 2. EFFECTS (useEffect, useLayoutEffect calls)
    // Must be done via traversal since effects can be deeply nested (e.g. in an if statement)
    ts.forEachChild(statement, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "useEffect" ||
          node.expression.text === "useLayoutEffect")
      ) {
        lineRanges.effects.push(getLineRange(node, sourceFile));
      }
    });

    // 3. HANDLERS (Arrow/Function Expressions assigned to const/let/var or standalone functions)
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        const initializer = decl.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer))
        ) {
          // Found a handler declared as const/let/var
          lineRanges.handlers.push(getLineRange(statement, sourceFile));
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement !== func) {
      // Found a handler declared as a named function inside the component body
      lineRanges.handlers.push(getLineRange(statement, sourceFile));
    }

    // 4. JSX (Return Statement)
    if (ts.isReturnStatement(statement)) {
      const expr = statement.expression;
      if (expr) {
        // Look for JSX directly or JSX wrapped in a fragment/parenthesis
        let targetNode: ts.Node = expr;
        if (ts.isParenthesizedExpression(targetNode)) {
          targetNode = targetNode.expression;
        }

        // We check if the expression itself is JSX (JsxElement, JsxSelfClosingElement, JsxFragment)
        // Note: The `containsJsx` function already confirms the component returns JSX.
        if (
          ts.isJsxElement(targetNode) ||
          ts.isJsxSelfClosingElement(targetNode) ||
          ts.isJsxFragment(targetNode)
        ) {
          // Set the JSX line range to the actual return expression/JSX block
          lineRanges.jsx = getLineRange(targetNode, sourceFile);
        }

        // Stop the loop after finding the return statement (usually the last thing)
        return;
      }
    }
  }
}
