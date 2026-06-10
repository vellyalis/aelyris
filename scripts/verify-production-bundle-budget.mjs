import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const ROOT = resolve(process.cwd());
const DIST = join(ROOT, "dist");
const ASSETS = join(DIST, "assets");
const INDEX = join(DIST, "index.html");
const OUT = join(ROOT, ".codex-auto", "quality", "production-bundle-budget.json");

const budgets = {
  entryJsBytes: 900 * 1024,
  initialJsBytes: 1_100 * 1024,
  initialCssBytes: 240 * 1024,
  initialGzipBytes: 360 * 1024,
};

const editorOnlyPattern = /(?:^|\/)(?:monaco-core|monaco-vim|(?:css|html|json|ts)\.worker)-|monaco-core-.*\.css$/;
const freshnessInputs = [join(ROOT, "vite.config.ts"), join(ROOT, "package.json"), join(ROOT, "scripts", "verify-production-bundle-budget.mjs")];

function hrefs(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}

function assetPath(href) {
  return join(DIST, href.replace(/^\//, ""));
}

function bytes(path) {
  return existsSync(path) ? statSync(path).size : 0;
}

function gzipBytes(path) {
  return existsSync(path) ? gzipSync(readFileSync(path)).length : 0;
}

function mtimeMs(path) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

function resource(href, kind) {
  const path = assetPath(href);
  return {
    href,
    kind,
    bytes: bytes(path),
    gzipBytes: gzipBytes(path),
    exists: existsSync(path),
  };
}

function pass(id, ok, detail, extra = {}) {
  return { id, status: ok ? "passed" : "failed", detail, ...extra };
}

const html = existsSync(INDEX) ? readFileSync(INDEX, "utf8") : "";
const scripts = hrefs(html, /<script[^>]+type="module"[^>]+src="([^"]+)"/g);
const modulepreloads = hrefs(html, /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g);
const stylesheets = hrefs(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g);
const initialResources = [
  ...scripts.map((href) => resource(href, "entry-script")),
  ...modulepreloads.map((href) => resource(href, "modulepreload")),
  ...stylesheets.map((href) => resource(href, "stylesheet")),
];

const entry = initialResources.find((item) => item.kind === "entry-script");
const initialJs = initialResources.filter((item) => item.href.endsWith(".js"));
const initialCss = initialResources.filter((item) => item.href.endsWith(".css"));
const initialEditorOnly = initialResources.filter((item) => editorOnlyPattern.test(item.href));
const assetNames = existsSync(ASSETS) ? readdirSync(ASSETS) : [];
const editorLazyAssets = assetNames.filter((name) => editorOnlyPattern.test(name) || /^EditorPanel-.*\.(js|css)$/.test(name));
const entryText = entry?.exists ? readFileSync(assetPath(entry.href), "utf8") : "";
const lazyEditorDependencyMap =
  /EditorPanel-.*\.js/.test(entryText) &&
  /monaco-core-.*\.js/.test(entryText) &&
  /monaco-core-.*\.css/.test(entryText);

const initialJsBytes = initialJs.reduce((sum, item) => sum + item.bytes, 0);
const initialCssBytes = initialCss.reduce((sum, item) => sum + item.bytes, 0);
const initialGzipBytes = initialResources.reduce((sum, item) => sum + item.gzipBytes, 0);
const latestFreshnessInputMs = Math.max(...freshnessInputs.map((path) => mtimeMs(path)));
const distFreshForBudgetInputs = existsSync(INDEX) && mtimeMs(INDEX) + 5_000 >= latestFreshnessInputMs;

const checks = [
  pass("dist-index-present", existsSync(INDEX), "dist/index.html exists"),
  pass(
    "dist-fresh-for-budget-inputs",
    distFreshForBudgetInputs,
    distFreshForBudgetInputs
      ? "dist/index.html is newer than bundle budget inputs"
      : "dist/index.html is older than vite/package/budget verifier inputs",
  ),
  pass("single-entry-script", scripts.length === 1, `${scripts.length} module entry script(s)`),
  pass("initial-resources-exist", initialResources.every((item) => item.exists), "all initial resources exist"),
  pass(
    "entry-js-budget",
    Boolean(entry && entry.bytes <= budgets.entryJsBytes),
    `${entry?.bytes ?? 0}/${budgets.entryJsBytes} bytes`,
    { observedBytes: entry?.bytes ?? 0, budgetBytes: budgets.entryJsBytes },
  ),
  pass(
    "initial-js-budget",
    initialJsBytes <= budgets.initialJsBytes,
    `${initialJsBytes}/${budgets.initialJsBytes} bytes`,
    { observedBytes: initialJsBytes, budgetBytes: budgets.initialJsBytes },
  ),
  pass(
    "initial-css-budget",
    initialCssBytes <= budgets.initialCssBytes,
    `${initialCssBytes}/${budgets.initialCssBytes} bytes`,
    { observedBytes: initialCssBytes, budgetBytes: budgets.initialCssBytes },
  ),
  pass(
    "initial-gzip-budget",
    initialGzipBytes <= budgets.initialGzipBytes,
    `${initialGzipBytes}/${budgets.initialGzipBytes} gzip bytes`,
    { observedBytes: initialGzipBytes, budgetBytes: budgets.initialGzipBytes },
  ),
  pass(
    "editor-assets-not-initial",
    initialEditorOnly.length === 0,
    initialEditorOnly.length === 0
      ? "Monaco/editor-only assets are lazy"
      : `initial editor-only assets: ${initialEditorOnly.map((item) => item.href).join(", ")}`,
    { initialEditorOnly: initialEditorOnly.map((item) => item.href) },
  ),
  pass(
    "editor-lazy-dependency-map",
    lazyEditorDependencyMap,
    lazyEditorDependencyMap
      ? "entry chunk keeps Monaco attached to the lazy EditorPanel dependency map"
      : "entry chunk does not prove EditorPanel -> Monaco lazy dependency map",
  ),
  pass(
    "editor-lazy-assets-present",
    editorLazyAssets.some((name) => name.startsWith("monaco-core-")) &&
      editorLazyAssets.some((name) => name.startsWith("EditorPanel-")),
    `${editorLazyAssets.length} editor-only lazy assets`,
    { editorLazyAssets },
  ),
];

const ok = checks.every((check) => check.status === "passed");
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  ok,
  status: ok ? "passed" : "failed",
  budgets,
  summary: {
    entryJsBytes: entry?.bytes ?? 0,
    initialJsBytes,
    initialCssBytes,
    initialGzipBytes,
    initialResourceCount: initialResources.length,
    editorLazyAssetCount: editorLazyAssets.length,
  },
  initialResources,
  freshnessInputs: freshnessInputs.map((path) => ({ path: path.replace(`${ROOT}\\`, ""), mtimeMs: mtimeMs(path) })),
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (!ok) {
  process.exitCode = 1;
}
