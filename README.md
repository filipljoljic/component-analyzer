# Component Archaeologist

[![smithery badge](https://smithery.ai/badge/@filipljoljic/component-analyzer)](https://smithery.ai/server/@filipljoljic/component-analyzer)

Static analysis tool for React (JS/TS) projects that helps you understand and refactor your component architecture.

It:

- Finds React components across your project (JS, JSX, TS, TSX)
- Classifies them into **page / shared / unknown**
- Shows **LOC, hooks, children, structure line ranges**
- Highlights **refactor hotspots** (large / complex components)
- Exposes everything as:
  - a **CLI** tool
  - an **MCP server** (via Smithery) usable from Cursor / other MCP clients

---

## Installation

Requirements:

- Node.js 18+
- npm

Clone and install:

```bash
git clone <your-repo-url> component-archaeologist
cd component-archaeologist
npm install
```

Local run:

```bash
npx @smithery/cli@latest dev src/mcp/server.ts
```