import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  PI_CACHE_DIR,
  PI_NORMALIZED_SESSION_VERSION,
  PI_SKIPPED_ENTRY_TYPES,
} from "./constants.js";

interface PiSessionHeader {
  sessionId: string;
  cwd: string;
  timestamp: string;
}

interface PiNormalizerState {
  events: Record<string, unknown>[];
  sessionId: string;
}

const parsePiLine = (line: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return undefined;
};

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

const extractTextContent = (contentBlocks: Record<string, unknown>[]): string => {
  const textParts: string[] = [];

  for (const contentBlock of contentBlocks) {
    if (contentBlock.type !== "text") continue;
    if (typeof contentBlock.text !== "string") continue;
    const text = contentBlock.text.trim();
    if (!text) continue;
    textParts.push(text);
  }

  return textParts.join("\n").trim();
};

const getToolInput = (input: unknown): Record<string, unknown> => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
};

const normalizeAssistantContent = (
  contentBlocks: Record<string, unknown>[],
): Record<string, unknown>[] => {
  const normalizedContent: Record<string, unknown>[] = [];

  for (const contentBlock of contentBlocks) {
    if (contentBlock.type === "text" && typeof contentBlock.text === "string") {
      const text = contentBlock.text.trim();
      if (!text) continue;
      normalizedContent.push({ type: "text", text });
      continue;
    }

    if (
      contentBlock.type === "thinking" &&
      typeof contentBlock.thinking === "string"
    ) {
      const thinking = contentBlock.thinking.trim();
      if (!thinking) continue;
      normalizedContent.push({ type: "thinking", thinking });
      continue;
    }

    if (
      contentBlock.type === "toolCall" &&
      typeof contentBlock.id === "string" &&
      typeof contentBlock.name === "string"
    ) {
      normalizedContent.push({
        type: "tool_use",
        id: contentBlock.id,
        name: contentBlock.name,
        input: getToolInput(contentBlock.arguments),
      });
    }
  }

  return normalizedContent;
};

const normalizeToolResultContent = (
  content: unknown,
): string | Record<string, unknown>[] => {
  if (typeof content === "string") {
    return content.trim();
  }

  const contentBlocks = getContentBlocks(content);
  if (isTextOnlyMessage(contentBlocks)) {
    return extractTextContent(contentBlocks);
  }

  return contentBlocks;
};

const pushEvent = (
  state: PiNormalizerState,
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

const pushToolResult = (
  state: PiNormalizerState,
  timestamp: string,
  toolUseId: string,
  content: string | Record<string, unknown>[],
  isError: boolean,
): void => {
  state.events.push({
    type: "user",
    sessionId: state.sessionId,
    timestamp,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
  });
};

export const readPiSessionHeader = async (
  sessionPath: string,
): Promise<PiSessionHeader | undefined> => {
  const sessionStat = fs.statSync(sessionPath);
  const stream = fs.createReadStream(sessionPath, { encoding: "utf-8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const parsed = parsePiLine(line);
      if (!parsed) return undefined;
      if (parsed.type !== "session") return undefined;
      if (typeof parsed.id !== "string") return undefined;

      return {
        sessionId: parsed.id,
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
        timestamp:
          typeof parsed.timestamp === "string"
            ? parsed.timestamp
            : sessionStat.mtime.toISOString(),
      };
    }
  } finally {
    reader.close();
    stream.close();
  }

  return undefined;
};

export const normalizePiSession = async (
  sessionPath: string,
  header: PiSessionHeader,
): Promise<Record<string, unknown>[]> => {
  const state: PiNormalizerState = {
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
      const parsed = parsePiLine(line);
      if (!parsed) continue;

      const parsedType = typeof parsed.type === "string" ? parsed.type : "";
      if (parsedType === "session" || PI_SKIPPED_ENTRY_TYPES.has(parsedType)) {
        continue;
      }

      if (parsedType !== "message") continue;
      if (!parsed.message || typeof parsed.message !== "object") continue;

      const message = parsed.message as Record<string, unknown>;
      const timestamp =
        typeof parsed.timestamp === "string"
          ? parsed.timestamp
          : header.timestamp;

      if (message.role === "user") {
        if (typeof message.content === "string") {
          const content = message.content.trim();
          if (!content) continue;
          pushEvent(state, timestamp, "user", content);
          continue;
        }

        const contentBlocks = getContentBlocks(message.content);
        if (contentBlocks.length === 0) continue;

        if (isTextOnlyMessage(contentBlocks)) {
          const content = extractTextContent(contentBlocks);
          if (!content) continue;
          pushEvent(state, timestamp, "user", content);
          continue;
        }

        pushEvent(state, timestamp, "user", contentBlocks);
        continue;
      }

      if (message.role === "assistant") {
        if (typeof message.content === "string") {
          const content = message.content.trim();
          if (!content) continue;
          pushEvent(state, timestamp, "assistant", [{ type: "text", text: content }]);
          continue;
        }

        const contentBlocks = getContentBlocks(message.content);
        if (contentBlocks.length === 0) continue;

        const normalizedContent = normalizeAssistantContent(contentBlocks);
        if (normalizedContent.length === 0) continue;
        pushEvent(state, timestamp, "assistant", normalizedContent);
        continue;
      }

      if (message.role !== "toolResult") continue;

      const content = normalizeToolResultContent(message.content);
      const hasContent =
        typeof content === "string" ? Boolean(content) : content.length > 0;
      const isError = Boolean(message.isError);
      if (!hasContent && !isError) continue;

      pushToolResult(
        state,
        timestamp,
        typeof message.toolCallId === "string" ? message.toolCallId : "unknown",
        content,
        isError,
      );
    }
  } finally {
    reader.close();
    stream.close();
  }

  return state.events;
};

export const getCachedNormalizedPath = (sessionId: string): string =>
  path.join(
    PI_CACHE_DIR,
    `${sessionId}.v${PI_NORMALIZED_SESSION_VERSION}.jsonl`,
  );

export const ensureNormalizedSession = async (
  sessionPath: string,
  header: PiSessionHeader,
): Promise<string> => {
  fs.mkdirSync(PI_CACHE_DIR, { recursive: true });
  const cachedPath = getCachedNormalizedPath(header.sessionId);

  const sessionStat = fs.statSync(sessionPath);
  if (fs.existsSync(cachedPath)) {
    const cachedStat = fs.statSync(cachedPath);
    if (cachedStat.mtimeMs >= sessionStat.mtimeMs) {
      return cachedPath;
    }
  }

  const events = await normalizePiSession(sessionPath, header);
  const payload = events.map((event) => JSON.stringify(event)).join("\n");
  fs.writeFileSync(cachedPath, payload ? `${payload}\n` : "");
  return cachedPath;
};
