import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(rootDir, "src", "lib", "archive.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
});

const archiveModule = { exports: {} };
const stubDb = {
  deleteRows: async () => [],
  insertRows: async () => [],
  patchRows: async () => [],
  selectRows: async () => [],
  uploadStorageFile: async () => ({ url: "" }),
};
const stubPreview = { getYoutubeThumbnailUrl: () => "" };
const localRequire = (id) => {
  if (id === "node:crypto") return require(id);
  if (id === "./fnos-db") return stubDb;
  if (id === "./archive-preview") return stubPreview;
  return require(id);
};

new Function("require", "module", "exports", outputText)(localRequire, archiveModule, archiveModule.exports);

const { archiveUrlHash, normalizeArchiveUrl } = archiveModule.exports;
if (typeof normalizeArchiveUrl !== "function" || typeof archiveUrlHash !== "function") {
  throw new Error("Archive URL helpers were not exported.");
}

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const cases = [
  [
    "https://www.example.com/path/?utm_source=newsletter&b=2&a=1#section",
    "https://example.com/path?a=1&b=2",
  ],
  [
    "www.youtube.com/watch?v=abc123&si=share-token&feature=shared",
    "https://youtube.com/watch?v=abc123",
  ],
  [
    "https://www.instagram.com/reel/ABC/?igsh=token&utm_medium=social",
    "https://instagram.com/reel/ABC",
  ],
  [
    "https://www.example.com/?fbclid=abc&app=mobile&share_id=xyz",
    "https://example.com",
  ],
];

for (const [input, expected] of cases) {
  const actual = normalizeArchiveUrl(input);
  if (actual !== expected) throw new Error(`normalizeArchiveUrl mismatch: ${input} -> ${actual}, expected ${expected}`);
  const hash = archiveUrlHash(input);
  if (hash !== sha256(expected)) throw new Error(`archiveUrlHash mismatch for ${input}`);
}

const hashA = archiveUrlHash("https://www.example.com/path/?utm_campaign=a&a=1#top");
const hashB = archiveUrlHash("https://example.com/path?a=1");
if (hashA !== hashB) throw new Error("Equivalent archive URLs did not produce the same hash.");

console.log("Archive URL normalization checks passed.");
