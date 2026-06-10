import react from "@vitejs/plugin-react";
import ts from "typescript";
import { defineConfig, type Plugin } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const noEsbuildSpawn = process.env.AETHER_VITE_NO_ESBUILD_SPAWN === "1";
const productionImportMetaEnv = JSON.stringify({
  DEV: false,
  MODE: "production",
  PROD: true,
  VITE_APP_VERSION: "unknown",
});

const monacoChunkWarningLimitKb = 3200;
const editorOnlyPreloadPattern = /(?:^|\/)(?:monaco-core|monaco-vim|(?:css|html|json|ts)\.worker)-|monaco-core-.*\.css$/;

function typescriptTranspilePlugin(): Plugin {
  return {
    name: "aether:typescript-transpile-no-esbuild-spawn",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0]?.replaceAll("\\", "/") ?? id;
      if (path.includes("/node_modules/") || !/\.[cm]?tsx?$/.test(path)) return null;

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

function inlineProductionEnvPlugin(): Plugin {
  return {
    name: "aether:inline-production-env-no-esbuild-spawn",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0]?.replaceAll("\\", "/") ?? id;
      if (!/\.(?:[cm]?[jt]sx?)$/.test(path)) return null;
      if (
        !code.includes("process.env.NODE_ENV") &&
        !code.includes("process.env?.NODE_ENV") &&
        !code.includes("global.process.env.NODE_ENV") &&
        !code.includes("global.process.env?.NODE_ENV") &&
        !code.includes("globalThis.process.env.NODE_ENV") &&
        !code.includes("globalThis.process.env?.NODE_ENV") &&
        !code.includes("import.meta.env")
      ) {
        return null;
      }

      return {
        code: code
          .replaceAll("globalThis.process.env?.NODE_ENV", JSON.stringify("production"))
          .replaceAll("globalThis.process.env.NODE_ENV", JSON.stringify("production"))
          .replaceAll("global.process.env?.NODE_ENV", JSON.stringify("production"))
          .replaceAll("global.process.env.NODE_ENV", JSON.stringify("production"))
          .replaceAll("process.env?.NODE_ENV", JSON.stringify("production"))
          .replaceAll("process.env.NODE_ENV", JSON.stringify("production"))
          .replace(/(?:globalThis\.|global\.)?process\.env\?\.\[['"]NODE_ENV['"]\]/g, JSON.stringify("production"))
          .replace(/(?:globalThis\.|global\.)?process\.env\[['"]NODE_ENV['"]\]/g, JSON.stringify("production"))
          .replace(/\bglobalThis\.process\.env\b/g, "({})")
          .replace(/\bglobal\.process\.env\b/g, "({})")
          .replace(/\bprocess\.env\b/g, "({})")
          .replace(/import\.meta\.env\?\.\[['"]DEV['"]\]/g, "false")
          .replace(/import\.meta\.env\?\.\[['"]PROD['"]\]/g, "true")
          .replace(/import\.meta\.env\?\.\[['"]MODE['"]\]/g, JSON.stringify("production"))
          .replace(/import\.meta\.env\?\.\[['"]VITE_APP_VERSION['"]\]/g, JSON.stringify("unknown"))
          .replace(/import\.meta\.env\[['"]DEV['"]\]/g, "false")
          .replace(/import\.meta\.env\[['"]PROD['"]\]/g, "true")
          .replace(/import\.meta\.env\[['"]MODE['"]\]/g, JSON.stringify("production"))
          .replace(/import\.meta\.env\[['"]VITE_APP_VERSION['"]\]/g, JSON.stringify("unknown"))
          .replaceAll("import.meta.env?.DEV", "false")
          .replaceAll("import.meta.env?.PROD", "true")
          .replaceAll("import.meta.env?.MODE", JSON.stringify("production"))
          .replaceAll("import.meta.env?.VITE_APP_VERSION", JSON.stringify("unknown"))
          .replaceAll("import.meta.env.DEV", "false")
          .replaceAll("import.meta.env.PROD", "true")
          .replaceAll("import.meta.env.MODE", JSON.stringify("production"))
          .replaceAll("import.meta.env.VITE_APP_VERSION", JSON.stringify("unknown"))
          .replaceAll("import.meta.env", productionImportMetaEnv),
        map: null,
      };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    noEsbuildSpawn ? inlineProductionEnvPlugin() : null,
    noEsbuildSpawn ? typescriptTranspilePlugin() : null,
    noEsbuildSpawn ? null : react(),
  ].filter((plugin): plugin is Plugin => Boolean(plugin)),
  esbuild: noEsbuildSpawn ? false : undefined,

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 30_000,
    exclude: ["node_modules", "e2e", ".claude/worktrees/**"],
  },

  build: {
    minify: noEsbuildSpawn ? false : undefined,
    commonjsOptions: noEsbuildSpawn
      ? {
          include: [
            /node_modules[\\\/](?:\.pnpm[\\\/])?(?:react|react-dom|scheduler|use-sync-external-store|remove-accents)(?:@|[\\\/])/,
          ],
        }
      : undefined,
    modulePreload: {
      polyfill: false,
      resolveDependencies: (_url, deps, context) => {
        if (context.hostType !== "html") return deps;
        return deps.filter((dep) => !editorOnlyPreloadPattern.test(dep));
      },
    },
    chunkSizeWarningLimit: monacoChunkWarningLimitKb,
    rollupOptions: {
      onwarn(warning, warn) {
        const id = String(warning.id ?? "").replaceAll("\\", "/");
        const message = String(warning.message ?? "");
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          id.includes("/node_modules/") &&
          message.includes('"use client"')
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes("monaco-vim")) return "monaco-vim";
          if (id.includes("@monaco-editor") || id.includes("monaco-editor")) return "monaco-core";
          if (id.includes("motion")) return "motion";
          if (id.includes("@radix-ui")) return "radix";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    open: false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
