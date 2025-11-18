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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeProject = analyzeProject;
//src/core/analyzer.ts
const typescript_1 = __importDefault(require("typescript"));
const path = __importStar(require("path"));
const project_1 = require("./project");
/**
 * Main entry for analyzing a project.
 * For now: detect React components and return basic info.
 */
function analyzeProject(options) {
    const { projectRoot } = options;
    const { sourceFiles, program } = (0, project_1.loadProject)(projectRoot);
    const components = [];
    for (const sf of sourceFiles) {
        if (sf.isDeclarationFile)
            continue;
        const filePath = sf.fileName;
        if (isTestFile(filePath))
            continue;
        typescript_1.default.forEachChild(sf, (node) => {
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
function isTestFile(filePath) {
    const lower = filePath.toLowerCase();
    return (lower.includes("/tests/") ||
        lower.includes("__mocks__") ||
        lower.endsWith(".test.js") ||
        lower.endsWith(".test.jsx") ||
        lower.endsWith(".test.ts") ||
        lower.endsWith(".test.tsx"));
}
function detectComponentInNode(node, sourceFile, program, filePath) {
    // 1) function declaration: function MyComponent(props) { return <div /> }
    if (typescript_1.default.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        if (isPascalCase(name) && containsJsx(node)) {
            return buildComponentInfoFromFunction(name, node, sourceFile, filePath);
        }
    }
    // 2) const MyComponent = (props) => { return <div /> }
    if (typescript_1.default.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
            if (!typescript_1.default.isIdentifier(decl.name))
                continue;
            const name = decl.name.text;
            if (!isPascalCase(name))
                continue;
            const initializer = decl.initializer;
            if (initializer &&
                (typescript_1.default.isArrowFunction(initializer) ||
                    typescript_1.default.isFunctionExpression(initializer)) &&
                containsJsx(initializer)) {
                return buildComponentInfoFromFunction(name, initializer, sourceFile, filePath);
            }
        }
    }
    return null;
}
function buildComponentInfoFromFunction(name, func, sourceFile, filePath) {
    // ✅ explicitly pass sourceFile to avoid the getSourceFileOfNode(undefined) issue
    const startPos = func.getStart(sourceFile);
    const endPos = func.getEnd();
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(startPos);
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(endPos);
    const loc = endLine - startLine + 1;
    const props = extractPropNames(func, sourceFile);
    const hooks = [];
    const children = [];
    if (func.body) {
        typescript_1.default.forEachChild(func.body, (node) => {
            collectHooks(node, sourceFile, hooks);
            collectChildren(node, sourceFile, children);
        });
    }
    const complexity = 0;
    const lineRanges = {
        state: null,
        effects: [],
        handlers: [],
        jsx: null,
    };
    collectStructuralRanges(func, sourceFile, lineRanges);
    const role = inferRoleFromPath(filePath);
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
function isPascalCase(name) {
    return /^[A-Z]/.test(name);
}
function containsJsx(node) {
    let hasJsx = false;
    if (!node.body)
        return false;
    function visit(n) {
        if (typescript_1.default.isJsxElement(n) ||
            typescript_1.default.isJsxSelfClosingElement(n) ||
            typescript_1.default.isJsxFragment(n)) {
            hasJsx = true;
            return;
        }
        typescript_1.default.forEachChild(n, visit);
    }
    typescript_1.default.forEachChild(node.body, visit);
    return hasJsx;
}
function extractPropNames(func, sourceFile) {
    if (!func.parameters.length)
        return [];
    const firstParam = func.parameters[0].name;
    const names = [];
    if (typescript_1.default.isObjectBindingPattern(firstParam)) {
        for (const el of firstParam.elements) {
            if (typescript_1.default.isIdentifier(el.name)) {
                names.push(el.name.text);
            }
        }
    }
    else if (typescript_1.default.isIdentifier(firstParam)) {
        // function MyComp(props) { ... } -> just "props"
        names.push(firstParam.text);
    }
    return names;
}
function collectHooks(node, sourceFile, hooks) {
    if (typescript_1.default.isCallExpression(node)) {
        const expr = node.expression;
        if (typescript_1.default.isIdentifier(expr)) {
            const name = expr.text;
            if (name.startsWith("use")) {
                hooks.push(name);
            }
        }
    }
    typescript_1.default.forEachChild(node, (child) => collectHooks(child, sourceFile, hooks));
}
function collectChildren(node, sourceFile, children) {
    if (typescript_1.default.isJsxOpeningElement(node) || typescript_1.default.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        if (typescript_1.default.isIdentifier(tag)) {
            const tagName = tag.text;
            // Heuristic: components are Capitalized, DOM elements are lowercase
            if (/^[A-Z]/.test(tagName)) {
                children.push(tagName);
            }
        }
    }
    typescript_1.default.forEachChild(node, (child) => collectChildren(child, sourceFile, children));
}
// Very simple path-based role inference for now
function inferRoleFromPath(filePath) {
    const lower = filePath.toLowerCase();
    if (lower.includes("/pages/"))
        return "page";
    if (lower.includes("/features/"))
        return "feature";
    if (lower.includes("/components/") ||
        lower.includes("/shared/") ||
        lower.includes("/ui/"))
        return "shared";
    return "unknown";
}
function buildGraph(components) {
    const graph = {};
    // 1) create nodes
    for (const comp of components) {
        if (!graph[comp.name]) {
            graph[comp.name] = {
                info: comp,
                parents: [],
                children: [],
            };
        }
        else {
            // ⚠️ simple behavior for duplicate names:
            // keep the first one as "info", but we could handle this better later
        }
    }
    // 2) connect edges based on children names
    for (const comp of components) {
        const parentNode = graph[comp.name];
        if (!parentNode)
            continue;
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
function getLineRange(node, sourceFile) {
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    // Convert 0-based index to 1-based line number
    return { start: startLine + 1, end: endLine + 1 };
}
function collectStructuralRanges(func, sourceFile, lineRanges) {
    // If the function has no body (e.g., it's an interface definition), stop.
    if (!func.body)
        return;
    // We only care about statements inside the function body's block
    const block = typescript_1.default.isBlock(func.body) ? func.body.statements : [func.body];
    for (const statement of block) {
        // 1. STATE (useState, useReducer calls)
        if (typescript_1.default.isVariableStatement(statement)) {
            const decl = statement.declarationList.declarations[0];
            const initializer = decl?.initializer;
            if (decl &&
                initializer &&
                typescript_1.default.isCallExpression(initializer) &&
                typescript_1.default.isIdentifier(initializer.expression) &&
                initializer.expression.text.startsWith("use") &&
                (initializer.expression.text.endsWith("State") ||
                    initializer.expression.text.endsWith("Reducer"))) {
                // If we find the first useState/useReducer, this marks the state block
                const currentRange = getLineRange(statement, sourceFile);
                if (lineRanges.state === null) {
                    lineRanges.state = currentRange;
                }
                else {
                    // Extend existing block
                    lineRanges.state.end = currentRange.end;
                }
            }
        }
        // 2. EFFECTS (useEffect, useLayoutEffect calls)
        // Must be done via traversal since effects can be deeply nested (e.g. in an if statement)
        typescript_1.default.forEachChild(statement, (node) => {
            if (typescript_1.default.isCallExpression(node) &&
                typescript_1.default.isIdentifier(node.expression) &&
                (node.expression.text === "useEffect" ||
                    node.expression.text === "useLayoutEffect")) {
                lineRanges.effects.push(getLineRange(node, sourceFile));
            }
        });
        // 3. HANDLERS (Arrow/Function Expressions assigned to const/let/var or standalone functions)
        if (typescript_1.default.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                const initializer = decl.initializer;
                if (initializer &&
                    (typescript_1.default.isArrowFunction(initializer) || typescript_1.default.isFunctionExpression(initializer))) {
                    // Found a handler declared as const/let/var
                    lineRanges.handlers.push(getLineRange(statement, sourceFile));
                }
            }
        }
        else if (typescript_1.default.isFunctionDeclaration(statement) && statement !== func) {
            // Found a handler declared as a named function inside the component body
            lineRanges.handlers.push(getLineRange(statement, sourceFile));
        }
        // 4. JSX (Return Statement)
        if (typescript_1.default.isReturnStatement(statement)) {
            const expr = statement.expression;
            if (expr) {
                // Look for JSX directly or JSX wrapped in a fragment/parenthesis
                let targetNode = expr;
                if (typescript_1.default.isParenthesizedExpression(targetNode)) {
                    targetNode = targetNode.expression;
                }
                // We check if the expression itself is JSX (JsxElement, JsxSelfClosingElement, JsxFragment)
                // Note: The `containsJsx` function already confirms the component returns JSX.
                if (typescript_1.default.isJsxElement(targetNode) ||
                    typescript_1.default.isJsxSelfClosingElement(targetNode) ||
                    typescript_1.default.isJsxFragment(targetNode)) {
                    // Set the JSX line range to the actual return expression/JSX block
                    lineRanges.jsx = getLineRange(targetNode, sourceFile);
                }
                // Stop the loop after finding the return statement (usually the last thing)
                return;
            }
        }
    }
}
