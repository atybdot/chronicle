import type { FileChange } from "../types";

export type FileAnalysisKind = "analyzable" | "asset";

export type FileClassification = {
  path: string;
  kind: FileAnalysisKind;
  reason: string;
};

type ClassifyFileOptions = {
  file: FileChange;
  diff?: string;
  untrackedContent?: string;
  untrackedBytes?: Uint8Array;
};

const ANALYZABLE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cts",
  ".env",
  ".gql",
  ".graphql",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".json5",
  ".jsonc",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lock",
  ".lua",
  ".markdown",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".php",
  ".pl",
  ".prisma",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".svelte",
  ".sql",
  ".svgz",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const NON_ANALYZABLE_EXTENSIONS = new Set([
  ".7z",
  ".aac",
  ".ai",
  ".aif",
  ".aiff",
  ".apk",
  ".avif",
  ".bin",
  ".bmp",
  ".bz2",
  ".class",
  ".cur",
  ".dll",
  ".doc",
  ".docx",
  ".eot",
  ".eps",
  ".exe",
  ".flac",
  ".gif",
  ".gz",
  ".heic",
  ".heif",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".ps",
  ".psd",
  ".rar",
  ".so",
  ".sqlite",
  ".tar",
  ".tif",
  ".tiff",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".xz",
  ".zip",
]);

const ANALYZABLE_BASENAMES = new Set([
  ".editorconfig",
  ".env",
  ".env.example",
  ".env.local",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  "dockerfile",
  "license",
  "makefile",
  "pnpm-lock.yaml",
  "readme",
  "readme.md",
  "readme.mdx",
  "tsconfig.json",
]);

const NON_ANALYZABLE_BASENAMES = new Set([
  ".ds_store",
  "thumbs.db",
]);

const BINARY_DIFF_MARKERS = ["GIT binary patch", "Binary files ", "Binary file "];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function getBasename(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  return (parts[parts.length - 1] ?? normalized).toLowerCase();
}

function getExtension(path: string): string {
  const basename = getBasename(path);
  const firstDot = basename.indexOf(".");
  if (firstDot <= 0) return "";
  return basename.slice(firstDot);
}

function containsBinaryDiffMarker(diff?: string): boolean {
  if (!diff) return false;
  return BINARY_DIFF_MARKERS.some((marker) => diff.includes(marker));
}

function isLikelyTextBytes(bytes?: Uint8Array): boolean {
  if (!bytes || bytes.length === 0) return true;

  let suspicious = 0;
  const inspected = Math.min(bytes.length, 4096);

  for (let i = 0; i < inspected; i++) {
    const value = bytes[i];
    if (value === undefined) continue;
    if (value === 0) return false;
    const isWhitespace = value === 9 || value === 10 || value === 13;
    const isPrintableAscii = value >= 32 && value <= 126;
    const isUtf8Continuation = value >= 128;
    if (!isWhitespace && !isPrintableAscii && !isUtf8Continuation) {
      suspicious++;
    }
  }

  return suspicious / inspected < 0.1;
}

function isLikelyTextContent(content?: string): boolean {
  if (content == null || content.length === 0) return true;

  let suspicious = 0;
  const inspected = Math.min(content.length, 4096);

  for (let i = 0; i < inspected; i++) {
    const code = content.charCodeAt(i);
    const isWhitespace = code === 9 || code === 10 || code === 13;
    const isPrintable = code >= 32 && code !== 127;
    if (!isWhitespace && !isPrintable) {
      suspicious++;
    }
  }

  return suspicious / inspected < 0.1;
}

function hasTextualPatch(diff?: string): boolean {
  if (!diff) return false;
  return diff.includes("@@") || diff.includes("+++ ") || diff.includes("--- ");
}

function hasKnownAnalyzableName(path: string): boolean {
  const basename = getBasename(path);
  if (ANALYZABLE_BASENAMES.has(basename)) return true;
  if (basename.startsWith(".env.")) return true;
  return false;
}

export function classifyFileChange(options: ClassifyFileOptions): FileClassification {
  const { file, diff, untrackedContent, untrackedBytes } = options;
  const basename = getBasename(file.path);
  const extension = getExtension(file.path);

  if (containsBinaryDiffMarker(diff)) {
    return { path: file.path, kind: "asset", reason: "binary-diff" };
  }

  if (NON_ANALYZABLE_BASENAMES.has(basename)) {
    return { path: file.path, kind: "asset", reason: "denylisted-basename" };
  }

  if (NON_ANALYZABLE_EXTENSIONS.has(extension)) {
    return { path: file.path, kind: "asset", reason: "denylisted-extension" };
  }

  const textLikeBytes = isLikelyTextBytes(untrackedBytes);
  const textLikeContent = isLikelyTextContent(untrackedContent);

  if (hasKnownAnalyzableName(file.path) || ANALYZABLE_EXTENSIONS.has(extension)) {
    if (!textLikeBytes || !textLikeContent) {
      return { path: file.path, kind: "asset", reason: "binary-content" };
    }

    return { path: file.path, kind: "analyzable", reason: "allowlisted" };
  }

  if (hasTextualPatch(diff)) {
    return { path: file.path, kind: "analyzable", reason: "textual-diff" };
  }

  if (file.status === "deleted") {
    return { path: file.path, kind: "analyzable", reason: "deleted-file" };
  }

  if (textLikeBytes && textLikeContent && (untrackedBytes != null || (untrackedContent?.length ?? 0) > 0)) {
    return { path: file.path, kind: "analyzable", reason: "text-content" };
  }

  return { path: file.path, kind: "asset", reason: "conservative-fallback" };
}

export function classifyFiles(options: {
  files: FileChange[];
  diffs: Map<string, string>;
  untrackedContent: Map<string, string>;
  untrackedBytes?: Map<string, Uint8Array>;
}): Map<string, FileClassification> {
  const classifications = new Map<string, FileClassification>();

  for (const file of options.files) {
    classifications.set(
      file.path,
      classifyFileChange({
        file,
        diff: options.diffs.get(file.path),
        untrackedContent: options.untrackedContent.get(file.path),
        untrackedBytes: options.untrackedBytes?.get(file.path),
      }),
    );
  }

  return classifications;
}

export const __internal = {
  getBasename,
  getExtension,
  hasTextualPatch,
  isLikelyTextBytes,
  isLikelyTextContent,
};
