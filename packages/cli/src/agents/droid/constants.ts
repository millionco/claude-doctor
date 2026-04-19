import * as os from "node:os";
import * as path from "node:path";

export const DROID_HOME = path.join(os.homedir(), ".factory");
export const DROID_SESSIONS_DIR = path.join(DROID_HOME, "sessions");

export const DROID_CACHE_DIR = path.join(
  os.homedir(),
  ".cache",
  "claude-doctor",
  "droid",
);

export const DROID_NORMALIZED_SESSION_VERSION = 1;
export const DROID_ENVIRONMENT_TEXT_PATTERNS: RegExp[] = [
  /^<system-reminder>/,
  /^<system-notification>/,
  /^# Task Tool Invocation/,
];

export const DROID_SKIPPED_EVENT_TYPES = new Set([
  "session_start",
  "todo_state",
  "compaction_state",
  "session_end",
]);

export const DROID_INTERRUPT_MESSAGES = [
  "Request interrupted by user",
  "Request cancelled by user",
];
