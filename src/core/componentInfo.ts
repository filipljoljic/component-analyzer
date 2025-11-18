// src/core/componentInfo.ts
export type ComponentRole = "page" | "feature" | "shared" | "unknown";

export interface LineRange {
  start: number; // 1-based line
  end: number; // 1-based line
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  role: ComponentRole;

  props: string[]; // names only for now
  hooks: string[]; // e.g. ['useState', 'useEffect', 'useScoresQuery']
  children: string[]; // component names used in JSX

  loc: number; // lines of code (start->end)
  complexity: number; // simple cyclomatic metric

  lineRanges: {
    state: LineRange | null;
    effects: LineRange[]; // each effect call
    handlers: LineRange[]; // handler function bodies
    jsx: LineRange | null; // return JSX block
  };
}

export interface GraphNode {
  info: ComponentInfo;
  parents: string[];
  children: string[];
}

export type ComponentGraph = Record<string, GraphNode>;
