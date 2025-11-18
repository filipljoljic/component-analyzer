// src/core/project.ts
import ts from "typescript";
import * as path from "path";
import * as fs from "fs";

export interface LoadedProject {
  program: ts.Program;
  sourceFiles: ts.SourceFile[];
}

/**
 * Load a TS Program for a given project root.
 * Supports both TS and JS files (allowJs: true).
 */
export function loadProject(projectRoot: string): LoadedProject {
  const tsconfigPath = findTsConfig(projectRoot);

  let config: ts.ParsedCommandLine;
  if (tsconfigPath) {
    const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (read.error) {
      throw new Error(
        "Failed to read tsconfig.json: " +
          ts.formatDiagnosticsWithColorAndContext([read.error], {
            getCurrentDirectory: ts.sys.getCurrentDirectory,
            getCanonicalFileName: (f) => f,
            getNewLine: () => ts.sys.newLine,
          })
      );
    }

    config = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(tsconfigPath)
    );
  } else {
    // Fallback: simple in-memory config
    config = ts.parseJsonConfigFileContent(
      {
        compilerOptions: {
          allowJs: true,
          jsx: "react-jsx",
          module: "commonjs",
          target: "ES2020",
        },
        include: ["src"],
      },
      ts.sys,
      projectRoot
    );
  }

  const program = ts.createProgram({
    rootNames: config.fileNames,
    options: config.options,
  });

  const allFiles = program.getSourceFiles();

  const reactish = allFiles.filter((sf) => {
    const fileName = sf.fileName;
    if (fileName.includes("node_modules")) return false;
    return (
      fileName.endsWith(".tsx") ||
      fileName.endsWith(".ts") ||
      fileName.endsWith(".jsx") ||
      fileName.endsWith(".js")
    );
  });

  return { program, sourceFiles: reactish };
}

function findTsConfig(projectRoot: string): string | null {
  const possible = path.join(projectRoot, "tsconfig.json");
  if (fs.existsSync(possible)) return possible;
  return null;
}
