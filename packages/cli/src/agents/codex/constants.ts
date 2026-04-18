import * as path from "node:path";
import * as os from "node:os";

export const CODEX_HOME = path.join(os.homedir(), ".codex");
export const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, "sessions");

export const CODEX_CACHE_DIR = path.join(
  os.homedir(),
  ".cache",
  "claude-doctor",
  "codex",
);

export const CODEX_TOOL_ERROR_PATTERNS: RegExp[] = [
  /^\s*error[:\s]/i,
  /^\s*Error:/,
  /"exit_code"\s*:\s*[1-9]/,
  /command failed/i,
  /permission denied/i,
  /<tool_use_error>/,
];

export const CODEX_ENVIRONMENT_TEXT_PATTERNS: RegExp[] = [
  /^<environment_context>/,
  /^<permissions instructions>/,
  /^<app-context>/,
  /^<collaboration_mode>/,
  /^<apps_instructions>/,
  /^<skills_instructions>/,
  /^<plugins_instructions>/,
  /^# AGENTS\.md instructions/,
];
