import react from "@vitejs/plugin-react";
import ts from "typescript";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// @ts-expect-error process is a nodejs global
const noEsbuildSpawn = process.env.AETHER_VITE_NO_ESBUILD_SPAWN === "1";

function typescriptTranspilePlugin(): Plugin {
  return {
    name: "aether:vitest-typescript-transpile-no-esbuild-spawn",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("?raw")) return null;
      const path = id.split("?")[0]?.replaceAll("\\", "/") ?? id;
      if (path.includes("/node_modules/") || !/\.[cm]?[jt]sx?$/.test(path)) return null;

      const result = ts.transpileModule(code, {
        fileName: path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          useDefineForClassFields: true,
          sourceMap: true,
        },
        reportDiagnostics: false,
      });

      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      };
    },
  };
}

export default defineConfig({
  plugins: [noEsbuildSpawn ? typescriptTranspilePlugin() : react()],
  esbuild: noEsbuildSpawn ? false : undefined,
  test: {
    environment: "jsdom",
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["src/__tests__/setup.ts"],
    exclude: ["node_modules", "e2e", ".claude/worktrees/**"],
    pool: noEsbuildSpawn ? "threads" : "forks",
    isolate: true,
  },
});
