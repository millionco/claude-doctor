import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  CODEX_CACHE_DIR,
  CODEX_ENVIRONMENT_TEXT_PATTERNS,
  CODEX_TOOL_ERROR_PATTERNS,
} from "./constants.js";

interface CodexSessionHeader {
  sessionId: string;
  cwd: string;
  timestamp: string;
}

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const blockRecord = block as Record<string, unknown>;
    const text = blockRecord.text ?? blockRecord.input_text;
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("\n");
};

const isEnvironmentText = (text: string): boolean =>
  CODEX_ENVIRONMENT_TEXT_PATTERNS.some((pattern) => pattern.test(text));

const isErrorOutput = (text: string): boolean =>
  CODEX_TOOL_ERROR_PATTERNS.some((pattern) => pattern.test(text));

const parseToolArguments = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== "string") {
    if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
};

const flattenOutput = (output: unknown): string => {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const block of output) {
      if (!block || typeof block !== "object") continue;
      const blockRecord = block as Record<string, unknown>;
      const text = blockRecord.text ?? blockRecord.input_text;
      if (typeof text === "string") parts.push(text);
    }
    return parts.join("\n");
  }
  if (output && typeof output === "object") {
    try {
      return JSON.stringify(output);
    } catch {
      return "";
    }
  }
  return "";
};

const parseCodexLine = (line: string): Record<string, unknown> | undefined => {
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

export const readCodexSessionHeader = async (
  rolloutPath: string,
): Promise<CodexSessionHeader | undefined> => {
  const stream = fs.createReadStream(rolloutPath, { encoding: "utf-8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const parsed = parseCodexLine(line);
      if (!parsed) return undefined;

      if (
        parsed.type === "session_meta" &&
        parsed.payload &&
        typeof parsed.payload === "object"
      ) {
        const payload = parsed.payload as Record<string, unknown>;
        const sessionId =
          typeof payload.id === "string" ? payload.id : undefined;
        const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
        const timestamp =
          typeof payload.timestamp === "string"
            ? payload.timestamp
            : typeof parsed.timestamp === "string"
              ? parsed.timestamp
              : new Date().toISOString();
        if (sessionId && cwd) {
          return { sessionId, cwd, timestamp };
        }
        return undefined;
      }

      if (
        typeof parsed.id === "string" &&
        typeof parsed.timestamp === "string"
      ) {
        return {
          sessionId: parsed.id,
          cwd: "",
          timestamp: parsed.timestamp,
        };
      }

      return undefined;
    }
  } finally {
    reader.close();
    stream.close();
  }
  return undefined;
};

interface NormalizerState {
  events: Record<string, unknown>[];
  sessionId: string;
  toolCallSeenUserAfter: Set<string>;
  lastAgentMessage?: string;
}

const pushUserText = (
  state: NormalizerState,
  timestamp: string,
  text: string,
): void => {
  if (!text.trim()) return;
  state.events.push({
    type: "user",
    sessionId: state.sessionId,
    timestamp,
    message: {
      role: "user",
      content: text,
    },
  });
};

const pushAssistantText = (
  state: NormalizerState,
  timestamp: string,
  text: string,
): void => {
  if (!text.trim()) return;
  if (state.lastAgentMessage === text) return;
  state.lastAgentMessage = text;
  state.events.push({
    type: "assistant",
    sessionId: state.sessionId,
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  });
};

const pushAssistantToolUse = (
  state: NormalizerState,
  timestamp: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  callId: string,
): void => {
  state.events.push({
    type: "assistant",
    sessionId: state.sessionId,
    timestamp,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: callId,
          name: toolName,
          input: toolInput,
        },
      ],
    },
  });
};

const pushToolResult = (
  state: NormalizerState,
  timestamp: string,
  callId: string,
  outputText: string,
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
          tool_use_id: callId,
          content: outputText,
          is_error: isError,
        },
      ],
    },
  });
  state.toolCallSeenUserAfter.add(callId);
};

const pushInterrupt = (state: NormalizerState, timestamp: string): void => {
  state.events.push({
    type: "user",
    sessionId: state.sessionId,
    timestamp,
    message: {
      role: "user",
      content: "[Request interrupted by user]",
    },
  });
};

const handleResponseItem = (
  state: NormalizerState,
  timestamp: string,
  payload: Record<string, unknown>,
): void => {
  const payloadType = payload.type;

  if (payloadType === "reasoning") return;

  if (payloadType === "message") {
    const role = payload.role;
    const text = extractTextFromContent(payload.content);
    if (!text) return;

    if (role === "assistant") {
      pushAssistantText(state, timestamp, text);
      return;
    }
    if (role === "user") {
      if (isEnvironmentText(text)) return;
      pushUserText(state, timestamp, text);
      return;
    }
    return;
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    const rawName = payload.name;
    const toolName = typeof rawName === "string" ? rawName : "unknown_tool";
    const argsField =
      payloadType === "function_call" ? payload.arguments : payload.input;
    const toolInput = parseToolArguments(argsField);
    const callId =
      typeof payload.call_id === "string"
        ? payload.call_id
        : `call_${state.events.length}`;
    pushAssistantToolUse(state, timestamp, toolName, toolInput, callId);
    return;
  }

  if (
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output"
  ) {
    const callId =
      typeof payload.call_id === "string"
        ? payload.call_id
        : `call_${state.events.length}`;
    const outputText = flattenOutput(payload.output);
    pushToolResult(
      state,
      timestamp,
      callId,
      outputText,
      isErrorOutput(outputText),
    );
    return;
  }
};

const handleEventMsg = (
  state: NormalizerState,
  timestamp: string,
  payload: Record<string, unknown>,
): void => {
  const payloadType = payload.type;

  if (payloadType === "turn_aborted" || payloadType === "error") {
    pushInterrupt(state, timestamp);
    return;
  }
};

const handleLegacyLine = (
  state: NormalizerState,
  timestamp: string,
  parsed: Record<string, unknown>,
): void => {
  const payloadType = parsed.type;

  if (payloadType === "reasoning") return;
  if (payloadType === "message") {
    handleResponseItem(state, timestamp, parsed);
    return;
  }
  if (
    payloadType === "function_call" ||
    payloadType === "custom_tool_call" ||
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output"
  ) {
    handleResponseItem(state, timestamp, parsed);
    return;
  }
};

export const normalizeCodexRollout = async (
  rolloutPath: string,
  header: CodexSessionHeader,
): Promise<Record<string, unknown>[]> => {
  const state: NormalizerState = {
    events: [],
    sessionId: header.sessionId,
    toolCallSeenUserAfter: new Set(),
  };

  const stream = fs.createReadStream(rolloutPath, { encoding: "utf-8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    const parsed = parseCodexLine(line);
    if (!parsed) continue;

    const topType = parsed.type;
    const timestamp =
      typeof parsed.timestamp === "string"
        ? parsed.timestamp
        : header.timestamp;

    if (topType === "session_meta" || topType === "turn_context") continue;
    if (
      parsed.record_type === "state" ||
      parsed.record_type === "turn" ||
      parsed.record_type === "compacted"
    ) {
      continue;
    }

    if (topType === "response_item") {
      const payload = parsed.payload;
      if (payload && typeof payload === "object") {
        handleResponseItem(
          state,
          timestamp,
          payload as Record<string, unknown>,
        );
      }
      continue;
    }

    if (topType === "event_msg") {
      const payload = parsed.payload;
      if (payload && typeof payload === "object") {
        handleEventMsg(state, timestamp, payload as Record<string, unknown>);
      }
      continue;
    }

    handleLegacyLine(state, timestamp, parsed);
  }

  return state.events;
};

export const getCachedNormalizedPath = (sessionId: string): string =>
  path.join(CODEX_CACHE_DIR, `${sessionId}.jsonl`);

export const ensureNormalizedSession = async (
  rolloutPath: string,
  header: CodexSessionHeader,
): Promise<string> => {
  fs.mkdirSync(CODEX_CACHE_DIR, { recursive: true });
  const cachedPath = getCachedNormalizedPath(header.sessionId);

  const rolloutStat = fs.statSync(rolloutPath);
  if (fs.existsSync(cachedPath)) {
    const cachedStat = fs.statSync(cachedPath);
    if (cachedStat.mtimeMs >= rolloutStat.mtimeMs) {
      return cachedPath;
    }
  }

  const events = await normalizeCodexRollout(rolloutPath, header);
  const payload = events.map((event) => JSON.stringify(event)).join("\n");
  fs.writeFileSync(cachedPath, payload ? `${payload}\n` : "");
  return cachedPath;
};
