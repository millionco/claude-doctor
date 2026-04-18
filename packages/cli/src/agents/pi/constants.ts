import * as os from "node:os";
import * as path from "node:path";

export const PI_HOME = path.join(os.homedir(), ".pi");
export const PI_AGENT_DIR = path.join(PI_HOME, "agent");
export const PI_SESSIONS_DIR = path.join(PI_AGENT_DIR, "sessions");

export const PI_CACHE_DIR = path.join(
  os.homedir(),
  ".cache",
  "claude-doctor",
  "pi",
);

export const PI_SKIPPED_ENTRY_TYPES = new Set([
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);
