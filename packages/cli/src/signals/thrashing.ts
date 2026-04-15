import {
  EDIT_TOOL_NAMES,
  THRASHING_EDIT_THRESHOLD,
  THRASHING_SEVERITY_CRITICAL,
  THRASHING_SEVERITY_HIGH,
} from "../constants.js";
import { parseTranscriptFile, extractToolUses } from "../parser.js";

const extractFilePath = (input: Record<string, unknown>): string | undefined => {
  for (const key of ["file_path", "path", "filePath", "target_file", "file"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

export const detectThrashing = async (
  filePath: string,
  sessionId: string,
): Promise<SignalResult[]> => {
  const events = await parseTranscriptFile(filePath);
  const toolUses = extractToolUses(events);

  const editCounts = new Map<string, FileEditCount>();

  for (const toolUse of toolUses) {
    const isEditTool = EDIT_TOOL_NAMES.some(
      (editToolName) =>
        toolUse.name.toLowerCase().includes(editToolName.toLowerCase()),
    );
    if (!isEditTool) continue;

    const targetPath = extractFilePath(toolUse.input);
    if (!targetPath) continue;

    const existing = editCounts.get(targetPath);
    if (existing) {
      existing.editCount++;
      if (!existing.toolNames.includes(toolUse.name)) {
        existing.toolNames.push(toolUse.name);
      }
    } else {
      editCounts.set(targetPath, {
        filePath: targetPath,
        editCount: 1,
        toolNames: [toolUse.name],
      });
    }
  }

  const signals: SignalResult[] = [];
  const thrashingFiles = [...editCounts.values()]
    .filter(
      (fileEditInfo) => fileEditInfo.editCount >= THRASHING_EDIT_THRESHOLD,
    )
    .sort((left, right) => right.editCount - left.editCount);

  if (thrashingFiles.length > 0) {
    const worstFile = thrashingFiles[0];
    const totalThrashingEdits = thrashingFiles.reduce(
      (sum, fileEditInfo) => sum + fileEditInfo.editCount,
      0,
    );

    signals.push({
      signalName: "edit-thrashing",
      severity:
        worstFile.editCount >= THRASHING_SEVERITY_CRITICAL
          ? "critical"
          : worstFile.editCount >= THRASHING_SEVERITY_HIGH
            ? "high"
            : "medium",
      score: -totalThrashingEdits,
      details: `${thrashingFiles.length} file(s) edited ${THRASHING_EDIT_THRESHOLD}+ times. Worst: ${worstFile.filePath} (${worstFile.editCount}x)`,
      sessionId,
      examples: thrashingFiles
        .slice(0, 5)
        .map(
          (fileEditInfo) =>
            `${fileEditInfo.filePath} (${fileEditInfo.editCount}x)`,
        ),
    });
  }

  return signals;
};
