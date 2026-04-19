import * as fs from "node:fs";
import * as readline from "node:readline";
import { META_MESSAGE_PATTERNS, INTERRUPT_PATTERN, MAX_USER_MESSAGE_LENGTH } from "./constants.js";

const isUserEvent = (event: TranscriptEvent): event is UserEvent => event.type === "user";

const isAssistantEvent = (event: TranscriptEvent): event is AssistantEvent =>
  event.type === "assistant";

export const parseTranscriptFile = async (filePath: string): Promise<TranscriptEvent[]> => {
  const events: TranscriptEvent[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lineReader) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* malformed JSONL line */
    }
  }

  return events;
};

export const extractUserMessages = (events: TranscriptEvent[]): string[] => {
  const messages: string[] = [];

  for (const event of events) {
    if (!isUserEvent(event)) continue;
    const content = event.message?.content;
    if (typeof content !== "string") continue;
    if (event.isMeta) continue;

    const isMetaMessage = META_MESSAGE_PATTERNS.some((pattern) => pattern.test(content));
    if (isMetaMessage) continue;

    if (content.length > MAX_USER_MESSAGE_LENGTH) continue;

    messages.push(content);
  }

  return messages;
};

export const extractToolUses = (events: TranscriptEvent[]): ToolUseEntry[] => {
  const toolUses: ToolUseEntry[] = [];

  for (const event of events) {
    if (!isAssistantEvent(event)) continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "tool_use") {
        const toolBlock = block as ToolUseBlock;
        toolUses.push({
          name: toolBlock.name,
          input: toolBlock.input,
          id: toolBlock.id,
        });
      }
    }
  }

  return toolUses;
};

export const extractToolErrors = (events: TranscriptEvent[]): number => {
  let errorCount = 0;

  for (const event of events) {
    if (!isUserEvent(event)) continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "tool_result") {
        const resultBlock = block as ToolResultBlock;
        if (resultBlock.is_error) {
          errorCount++;
          continue;
        }
        const resultContent =
          typeof resultBlock.content === "string"
            ? resultBlock.content
            : resultBlock.content
                ?.map((innerBlock: { type: string; text?: string }) => innerBlock.text ?? "")
                .join("");
        if (resultContent?.includes("<tool_use_error>")) {
          errorCount++;
        }
      }
    }
  }

  return errorCount;
};

export const countInterrupts = (events: TranscriptEvent[]): number => {
  let count = 0;

  for (const event of events) {
    if (!isUserEvent(event)) continue;
    const content = event.message?.content;
    if (typeof content !== "string") continue;
    if (INTERRUPT_PATTERN.test(content)) {
      count++;
    }
  }

  return count;
};

export const getSessionTimeRange = (events: TranscriptEvent[]): SessionTimeRange => {
  let earliest = Infinity;
  let latest = -Infinity;

  for (const event of events) {
    if (!event.timestamp) continue;
    const time = new Date(event.timestamp).getTime();
    if (time < earliest) earliest = time;
    if (time > latest) latest = time;
  }

  return {
    start: new Date(earliest === Infinity ? 0 : earliest),
    end: new Date(latest === -Infinity ? 0 : latest),
  };
};

export { isUserEvent, isAssistantEvent };
