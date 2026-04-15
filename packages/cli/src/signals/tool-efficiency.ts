import {
  READ_TOOL_NAMES,
  EDIT_TOOL_NAMES,
  READ_TO_EDIT_RATIO_THRESHOLD,
  READ_TO_EDIT_RATIO_HIGH,
  READ_ONLY_SESSION_THRESHOLD,
  READ_ONLY_SESSION_SCORE,
} from "../constants.js";
import { parseTranscriptFile, extractToolUses } from "../parser.js";

export const detectToolInefficiency = async (
  filePath: string,
  sessionId: string,
): Promise<SignalResult[]> => {
  const events = await parseTranscriptFile(filePath);
  const toolUses = extractToolUses(events);

  let readCount = 0;
  let editCount = 0;

  for (const toolUse of toolUses) {
    const toolNameLower = toolUse.name.toLowerCase();

    const isReadTool = READ_TOOL_NAMES.some((readToolName) =>
      toolNameLower.includes(readToolName.toLowerCase()),
    );
    const isEditTool = EDIT_TOOL_NAMES.some((editToolName) =>
      toolNameLower.includes(editToolName.toLowerCase()),
    );

    if (isReadTool) readCount++;
    if (isEditTool) editCount++;
  }

  const signals: SignalResult[] = [];

  if (editCount > 0) {
    const ratio = readCount / editCount;

    if (ratio >= READ_TO_EDIT_RATIO_THRESHOLD) {
      signals.push({
        signalName: "excessive-exploration",
        severity: ratio >= READ_TO_EDIT_RATIO_HIGH ? "high" : "medium",
        score: -Math.round(ratio),
        details: `Read-to-edit ratio: ${ratio.toFixed(1)}:1 (${readCount} reads, ${editCount} edits). Agent explored excessively before acting.`,
        sessionId,
      });
    }
  } else if (readCount > READ_ONLY_SESSION_THRESHOLD) {
    signals.push({
      signalName: "read-only-session",
      severity: "medium",
      score: READ_ONLY_SESSION_SCORE,
      details: `${readCount} read operations with zero edits — agent may have been stuck or just exploring.`,
      sessionId,
    });
  }

  return signals;
};
