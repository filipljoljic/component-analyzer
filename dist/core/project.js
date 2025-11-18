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
exports.loadProject = loadProject;
// src/core/project.ts
const typescript_1 = __importDefault(require("typescript"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * Load a TS Program for a given project root.
 * Supports both TS and JS files (allowJs: true).
 */
function loadProject(projectRoot) {
    const tsconfigPath = findTsConfig(projectRoot);
    let config;
    if (tsconfigPath) {
        const read = typescript_1.default.readConfigFile(tsconfigPath, typescript_1.default.sys.readFile);
        if (read.error) {
            throw new Error("Failed to read tsconfig.json: " +
                typescript_1.default.formatDiagnosticsWithColorAndContext([read.error], {
                    getCurrentDirectory: typescript_1.default.sys.getCurrentDirectory,
                    getCanonicalFileName: (f) => f,
                    getNewLine: () => typescript_1.default.sys.newLine,
                }));
        }
        config = typescript_1.default.parseJsonConfigFileContent(read.config, typescript_1.default.sys, path.dirname(tsconfigPath));
    }
    else {
        // Fallback: simple in-memory config
        config = typescript_1.default.parseJsonConfigFileContent({
            compilerOptions: {
                allowJs: true,
                jsx: "react-jsx",
                module: "commonjs",
                target: "ES2020",
            },
            include: ["src"],
        }, typescript_1.default.sys, projectRoot);
    }
    const program = typescript_1.default.createProgram({
        rootNames: config.fileNames,
        options: config.options,
    });
    const allFiles = program.getSourceFiles();
    const reactish = allFiles.filter((sf) => {
        const fileName = sf.fileName;
        if (fileName.includes("node_modules"))
            return false;
        return (fileName.endsWith(".tsx") ||
            fileName.endsWith(".ts") ||
            fileName.endsWith(".jsx") ||
            fileName.endsWith(".js"));
    });
    return { program, sourceFiles: reactish };
}
function findTsConfig(projectRoot) {
    const possible = path.join(projectRoot, "tsconfig.json");
    if (fs.existsSync(possible))
        return possible;
    return null;
}
