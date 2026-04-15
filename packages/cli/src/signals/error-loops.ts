import {
  ERROR_LOOP_THRESHOLD,
  ERROR_LOOP_CRITICAL_THRESHOLD,
  ERROR_SNIPPET_MAX_LENGTH,
} from "../constants.js";
import { parseTranscriptFile, isUserEvent, isAssistantEvent } from "../parser.js";

export const detectErrorLoops = async (
  filePath: string,
  sessionId: string,
): Promise<SignalResult[]> => {
  const events = await parseTranscriptFile(filePath);
  const errorSequences: ErrorSequence[] = [];

  let currentToolName: string | undefined;
  let consecutiveFailures = 0;
  let errorSnippets: string[] = [];

  for (const event of events) {
    if (isAssistantEvent(event)) {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === "tool_use") {
          currentToolName = (block as ToolUseBlock).name;
        }
      }
    }

    if (isUserEvent(event)) {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const resultBlock = block as ToolResultBlock;

        const isError = resultBlock.is_error === true;
        const resultText =
          typeof resultBlock.content === "string"
            ? resultBlock.content
            : resultBlock.content
                ?.map((innerBlock: { type: string; text?: string }) => innerBlock.text ?? "")
                .join("");
        const hasErrorMarker = resultText?.includes("<tool_use_error>");

        if (isError || hasErrorMarker) {
          consecutiveFailures++;
          const snippet = resultText?.slice(0, ERROR_SNIPPET_MAX_LENGTH) ?? "unknown error";
          errorSnippets.push(snippet);
        } else {
          if (
            consecutiveFailures >= ERROR_LOOP_THRESHOLD &&
            currentToolName
          ) {
            errorSequences.push({
              toolName: currentToolName,
              consecutiveFailures,
              errorSnippets: [...errorSnippets],
            });
          }
          consecutiveFailures = 0;
          errorSnippets = [];
        }
      }
    }
  }

  if (consecutiveFailures >= ERROR_LOOP_THRESHOLD && currentToolName) {
    errorSequences.push({
      toolName: currentToolName,
      consecutiveFailures,
      errorSnippets: [...errorSnippets],
    });
  }

  const signals: SignalResult[] = [];

  for (const sequence of errorSequences) {
    signals.push({
      signalName: "error-loop",
      severity: sequence.consecutiveFailures >= ERROR_LOOP_CRITICAL_THRESHOLD ? "critical" : "high",
      score: -sequence.consecutiveFailures,
      details: `${sequence.consecutiveFailures} consecutive failures on tool "${sequence.toolName}"`,
      sessionId,
      examples: sequence.errorSnippets.slice(0, 3),
    });
  }

  return signals;
};
