export function coerceShellOutput(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).trim();
  if (value == null) return "";
  return String(value).trim();
}

export function formatGitCommandOutput(error: unknown): string {
  if (!error || typeof error !== "object") return "";

  const shellError = error as { stdout?: unknown; stderr?: unknown };
  const stderr = coerceShellOutput(shellError.stderr);
  const stdout = coerceShellOutput(shellError.stdout);
  const sections: string[] = [];

  if (stderr) sections.push(`stderr:\n${stderr}`);
  if (stdout) sections.push(`stdout:\n${stdout}`);

  return sections.join("\n\n");
}

const GIT_HOOK_ERROR_PATTERNS = [
  /husky/i,
  /pre-commit/i,
  /commit-msg/i,
  /lint-staged/i,
  /prepare-commit-msg/i,
  /post-commit/i,
  /hooks\/(pre-commit|commit-msg|prepare-commit-msg|post-commit)/i,
  /git hook/i,
  /hook failed/i,
  /hook declined/i,
];

export function isGitHookError(message: string): boolean {
  return GIT_HOOK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
