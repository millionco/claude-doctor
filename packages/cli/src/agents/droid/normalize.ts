import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  DROID_CACHE_DIR,
  DROID_ENVIRONMENT_TEXT_PATTERNS,
  DROID_INTERRUPT_MESSAGES,
  DROID_SKIPPED_EVENT_TYPES,
} from "./constants.js";

interface DroidSessionHeader {
  sessionId: string;
  cwd: string;
  timestamp: string;
}

interface DroidNormalizerState {
  events: Record<string, unknown>[];
  sessionId: string;
}

const parseDroidLine = (line: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* skip malformed line */
  }
  return undefined;
};

const isEnvironmentText = (text: string): boolean =>
  DROID_ENVIRONMENT_TEXT_PATTERNS.some((pattern) => pattern.test(text));

const getContentBlocks = (content: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(content)) return [];

  const contentBlocks: Record<string, unknown>[] = [];
  for (const contentBlock of content) {
    if (!contentBlock || typeof contentBlock !== "object") continue;
    contentBlocks.push(contentBlock as Record<string, unknown>);
  }

  return contentBlocks;
};

const isTextOnlyMessage = (contentBlocks: Record<string, unknown>[]): boolean =>
  contentBlocks.length > 0 &&
  contentBlocks.every((contentBlock) => contentBlock.type === "text");

const extractUserText = (contentBlocks: Record<string, unknown>[]): string => {
  const textParts: string[] = [];

  for (const contentBlock of contentBlocks) {
    if (contentBlock.type !== "text") continue;
    if (typeof contentBlock.text !== "string") continue;
    const text = contentBlock.text.trim();
    if (!text || isEnvironmentText(text)) continue;
    textParts.push(text);
  }

  return textParts.join("\n").trim();
};

const normalizeInterruptText = (text: string): string =>
  DROID_INTERRUPT_MESSAGES.includes(text)
    ? "[Request interrupted by user]"
    : text;

const pushEvent = (
  state: DroidNormalizerState,
  timestamp: string,
  role: "user" | "assistant",
  content: string | Record<string, unknown>[],
): void => {
  state.events.push({
    type: role,
    sessionId: state.sessionId,
    timestamp,
    message: {
      role,
      content,
    },
  });
};

export const readDroidSessionHeader = async (
  sessionPath: string,
): Promise<DroidSessionHeader | undefined> => {
  const sessionStat = fs.statSync(sessionPath);
  const stream = fs.createReadStream(sessionPath, { encoding: "utf-8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const parsed = parseDroidLine(line);
      if (!parsed) return undefined;
      if (parsed.type !== "session_start") return undefined;
      if (typeof parsed.id !== "string") return undefined;

      return {
        sessionId: parsed.id,
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
        timestamp: sessionStat.mtime.toISOString(),
      };
    }
  } finally {
    reader.close();
    stream.close();
  }

  return undefined;
};

export const normalizeDroidSession = async (
  sessionPath: string,
  header: DroidSessionHeader,
): Promise<Record<string, unknown>[]> => {
  const state: DroidNormalizerState = {
    events: [],
    sessionId: header.sessionId,
  };

  const stream = fs.createReadStream(sessionPath, { encoding: "utf-8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const parsed = parseDroidLine(line);
      if (!parsed) continue;

      const parsedType = typeof parsed.type === "string" ? parsed.type : "";
      if (DROID_SKIPPED_EVENT_TYPES.has(parsedType)) {
        continue;
      }

      if (parsedType !== "message") continue;
      if (!parsed.message || typeof parsed.message !== "object") continue;

      const message = parsed.message as Record<string, unknown>;
      if (message.visibility === "user_only") continue;

      const timestamp =
        typeof parsed.timestamp === "string"
          ? parsed.timestamp
          : header.timestamp;

      if (message.role === "user") {
        if (typeof message.content === "string") {
          const content = message.content.trim();
          if (!content || isEnvironmentText(content)) continue;
          pushEvent(state, timestamp, "user", normalizeInterruptText(content));
          continue;
        }

        const contentBlocks = getContentBlocks(message.content);
        if (contentBlocks.length === 0) continue;

        if (isTextOnlyMessage(contentBlocks)) {
          const content = normalizeInterruptText(extractUserText(contentBlocks));
          if (!content) continue;
          pushEvent(state, timestamp, "user", content);
          continue;
        }

        pushEvent(state, timestamp, "user", contentBlocks);
        continue;
      }

      if (message.role !== "assistant") continue;

      if (typeof message.content === "string") {
        const content = message.content.trim();
        if (!content) continue;
        pushEvent(state, timestamp, "assistant", [{ type: "text", text: content }]);
        continue;
      }

      const contentBlocks = getContentBlocks(message.content);
      if (contentBlocks.length === 0) continue;
      pushEvent(state, timestamp, "assistant", contentBlocks);
    }
  } finally {
    reader.close();
    stream.close();
  }

  return state.events;
};

export const getCachedNormalizedPath = (sessionId: string): string =>
  path.join(DROID_CACHE_DIR, `${sessionId}.jsonl`);

export const ensureNormalizedSession = async (
  sessionPath: string,
  header: DroidSessionHeader,
): Promise<string> => {
  fs.mkdirSync(DROID_CACHE_DIR, { recursive: true });
  const cachedPath = getCachedNormalizedPath(header.sessionId);

  const sessionStat = fs.statSync(sessionPath);
  if (fs.existsSync(cachedPath)) {
    const cachedStat = fs.statSync(cachedPath);
    if (cachedStat.mtimeMs >= sessionStat.mtimeMs) {
      return cachedPath;
    }
  }

  const events = await normalizeDroidSession(sessionPath, header);
  const payload = events.map((event) => JSON.stringify(event)).join("\n");
  fs.writeFileSync(cachedPath, payload ? `${payload}\n` : "");
  return cachedPath;
};
