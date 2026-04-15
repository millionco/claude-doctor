import Sentiment from "sentiment";
import { parseTranscriptFile, isUserEvent } from "./parser.js";
import {
  SENTINEL_CUSTOM_TOKENS,
  INTERRUPT_PATTERN,
  META_MESSAGE_PATTERNS,
  MAX_USER_MESSAGE_LENGTH,
  CORRECTION_PATTERNS,
  KEEP_GOING_PATTERNS,
  HEALTH_GOOD_THRESHOLD,
  HEALTH_FAIR_THRESHOLD,
  HEALTH_BAR_WIDTH,
  TIMELINE_MAX_WIDTH,
  SNIPPET_LENGTH,
  PROBLEM_TURNS_DISPLAY_LIMIT,
  SIGNAL_DETAIL_DISPLAY_LENGTH,
  REPORT_PROJECT_LIMIT,
  VIZ_SENTIMENT_RED_THRESHOLD,
  VIZ_SENTIMENT_YELLOW_THRESHOLD,
} from "./constants.js";

const analyzer = new Sentiment();

const CUSTOM_SCORING: Record<string, number> = {};
for (const [phrase, score] of Object.entries(SENTINEL_CUSTOM_TOKENS)) {
  for (const word of phrase.split(" ")) {
    if (CUSTOM_SCORING[word] === undefined || score < CUSTOM_SCORING[word]) {
      CUSTOM_SCORING[word] = score;
    }
  }
}

const isMetaContent = (content: string): boolean =>
  META_MESSAGE_PATTERNS.some((pattern) => pattern.test(content));

export const buildSessionTimeline = async (
  filePath: string,
): Promise<SessionTimeline> => {
  const events = await parseTranscriptFile(filePath);
  const turns: TurnHealth[] = [];
  let turnIndex = 0;

  for (const event of events) {
    if (isUserEvent(event)) {
      const content = event.message?.content;

      if (Array.isArray(content)) {
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
            turns.push({
              index: turnIndex++,
              type: "tool-error",
              health: "red",
              reason: "tool failure",
              snippet: resultText?.slice(0, SNIPPET_LENGTH),
            });
          }
        }
        continue;
      }

      if (typeof content !== "string") continue;
      if (event.isMeta) continue;

      if (INTERRUPT_PATTERN.test(content)) {
        turns.push({
          index: turnIndex++,
          type: "interrupt",
          health: "red",
          reason: "user interrupted",
        });
        continue;
      }

      if (isMetaContent(content)) continue;
      if (content.length > MAX_USER_MESSAGE_LENGTH) continue;

      const isCorrection = CORRECTION_PATTERNS.some((pattern) =>
        pattern.test(content),
      );
      const isKeepGoing = KEEP_GOING_PATTERNS.some((pattern) =>
        pattern.test(content.trim()),
      );
      const sentimentResult = analyzer.analyze(content, {
        extras: CUSTOM_SCORING,
      });

      let health: "green" | "yellow" | "red" = "green";
      let reason: string | undefined;

      if (isCorrection || sentimentResult.comparative < VIZ_SENTIMENT_RED_THRESHOLD) {
        health = "red";
        reason = isCorrection
          ? "correction"
          : `negative (${sentimentResult.comparative.toFixed(1)})`;
      } else if (
        isKeepGoing ||
        sentimentResult.comparative < VIZ_SENTIMENT_YELLOW_THRESHOLD
      ) {
        health = "yellow";
        reason = isKeepGoing ? "keep going" : "mildly negative";
      }

      turns.push({
        index: turnIndex++,
        type: "user",
        health,
        reason,
        snippet: content.slice(0, SNIPPET_LENGTH),
      });
    }

    if (event.type === "assistant") {
      turns.push({
        index: turnIndex++,
        type: "assistant",
        health: "green",
      });
    }
  }

  const scorableTurns = turns.filter(
    (turn) => turn.type === "user" || turn.type === "tool-error" || turn.type === "interrupt",
  );
  const greenCount = scorableTurns.filter(
    (turn) => turn.health === "green",
  ).length;
  const healthPercentage =
    scorableTurns.length > 0
      ? Math.round((greenCount / scorableTurns.length) * 100)
      : 100;

  let summary: string;
  if (healthPercentage >= HEALTH_GOOD_THRESHOLD) {
    summary = "Session is healthy";
  } else if (healthPercentage >= HEALTH_FAIR_THRESHOLD) {
    summary = "Session has issues";
  } else {
    summary = "Session is struggling";
  }

  return { turns, healthPercentage, summary };
};

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const healthColor = (health: "green" | "yellow" | "red"): string => {
  if (health === "green") return GREEN;
  if (health === "yellow") return YELLOW;
  return RED;
};

const healthBlock = (health: "green" | "yellow" | "red"): string =>
  `${healthColor(health)}█${RESET}`;

export const renderTimeline = (
  turns: TurnHealth[],
  maxWidth: number = TIMELINE_MAX_WIDTH,
): string => {
  if (turns.length === 0) return `${DIM}(no turns)${RESET}`;

  const userTurns = turns.filter(
    (turn) => turn.type !== "assistant",
  );

  if (userTurns.length === 0) return `${DIM}(no user turns)${RESET}`;

  if (userTurns.length <= maxWidth) {
    return userTurns.map((turn) => healthBlock(turn.health)).join("");
  }

  const bucketSize = userTurns.length / maxWidth;
  const blocks: string[] = [];

  for (
    let bucketIndex = 0;
    bucketIndex < maxWidth;
    bucketIndex++
  ) {
    const bucketStart = Math.floor(bucketIndex * bucketSize);
    const bucketEnd = Math.floor((bucketIndex + 1) * bucketSize);
    const bucket = userTurns.slice(bucketStart, bucketEnd);

    if (bucket.length === 0) {
      blocks.push(healthBlock("green"));
      continue;
    }

    const hasRed = bucket.some((turn) => turn.health === "red");
    const hasYellow = bucket.some((turn) => turn.health === "yellow");

    if (hasRed) {
      blocks.push(healthBlock("red"));
    } else if (hasYellow) {
      blocks.push(healthBlock("yellow"));
    } else {
      blocks.push(healthBlock("green"));
    }
  }

  return blocks.join("");
};

export const renderHealthBar = (percentage: number): string => {
  const filled = Math.round((percentage / 100) * HEALTH_BAR_WIDTH);
  const empty = HEALTH_BAR_WIDTH - filled;

  let color: string;
  if (percentage >= HEALTH_GOOD_THRESHOLD) color = GREEN;
  else if (percentage >= HEALTH_FAIR_THRESHOLD) color = YELLOW;
  else color = RED;

  const filledBar = `${color}${"█".repeat(filled)}${RESET}`;
  const emptyBar = `${DIM}${"░".repeat(empty)}${RESET}`;

  return `${filledBar}${emptyBar} ${color}${percentage}%${RESET}`;
};

export const renderCheckOutput = (
  sessionId: string,
  turns: TurnHealth[],
  healthPercentage: number,
  summary: string,
  activeSignals: SignalResult[],
  guidance: string[],
): string => {
  const lines: string[] = [];

  const statusColor =
    healthPercentage >= HEALTH_GOOD_THRESHOLD ? GREEN : healthPercentage >= HEALTH_FAIR_THRESHOLD ? YELLOW : RED;

  lines.push(`${BOLD}Session${RESET}  ${sessionId.slice(0, 8)}`);
  lines.push(`${BOLD}Health${RESET}   ${renderHealthBar(healthPercentage)}  ${statusColor}${summary}${RESET}`);
  lines.push("");

  lines.push(`${BOLD}Timeline${RESET}`);
  lines.push(renderTimeline(turns));

  const userTurns = turns.filter((turn) => turn.type !== "assistant");
  const redCount = userTurns.filter((turn) => turn.health === "red").length;
  const yellowCount = userTurns.filter((turn) => turn.health === "yellow").length;
  const greenCount = userTurns.filter((turn) => turn.health === "green").length;

  lines.push(
    `${DIM}${greenCount > 0 ? `${GREEN}█${RESET}${DIM} ok:${greenCount} ` : ""}${yellowCount > 0 ? `${YELLOW}█${RESET}${DIM} warn:${yellowCount} ` : ""}${redCount > 0 ? `${RED}█${RESET}${DIM} bad:${redCount}` : ""}${RESET}`,
  );
  lines.push("");

  if (activeSignals.length > 0) {
    lines.push(`${BOLD}Signals${RESET} (${activeSignals.length})`);
    for (const signal of activeSignals) {
      const severityColor =
        signal.severity === "critical"
          ? RED
          : signal.severity === "high"
            ? YELLOW
            : DIM;
      const badge =
        signal.severity === "critical"
          ? "CRIT"
          : signal.severity === "high"
            ? "HIGH"
            : signal.severity === "medium"
              ? "MED "
              : "LOW ";
      lines.push(
        `  ${severityColor}${badge}${RESET} ${signal.signalName}${DIM} — ${signal.details.slice(0, SIGNAL_DETAIL_DISPLAY_LENGTH)}${RESET}`,
      );
    }
    lines.push("");
  }

  const redTurns = turns.filter(
    (turn) => turn.health === "red" && turn.snippet,
  );
  if (redTurns.length > 0) {
    lines.push(`${BOLD}Problem turns${RESET}`);
    for (const turn of redTurns.slice(0, PROBLEM_TURNS_DISPLAY_LIMIT)) {
      const label = turn.type === "tool-error"
        ? "tool-err"
        : turn.type === "interrupt"
          ? "interrupt"
          : turn.reason ?? "negative";
      lines.push(
        `  ${RED}#${turn.index}${RESET} ${DIM}[${label}]${RESET} ${turn.snippet ?? ""}`,
      );
    }
    lines.push("");
  }

  if (guidance.length > 0) {
    lines.push(`${BOLD}Guidance${RESET}`);
    for (const guidanceItem of guidance) {
      lines.push(`  ${YELLOW}→${RESET} ${guidanceItem}`);
    }
  } else {
    lines.push(`${GREEN}No issues detected. Session looks healthy.${RESET}`);
  }

  return lines.join("\n");
};

const PROJECT_NAME_WIDTH = 30;
const BAR_LABEL_WIDTH = 4;

const truncateProjectName = (name: string): string => {
  const shortName = name.replace(/^Users\/[^/]+\/Developer\//, "");
  if (shortName.length <= PROJECT_NAME_WIDTH) return shortName.padEnd(PROJECT_NAME_WIDTH);
  return "…" + shortName.slice(-(PROJECT_NAME_WIDTH - 1));
};

const scoreToHealthPercentage = (project: ProjectAnalysis): number => {
  if (project.signals.length === 0) return 100;

  const criticalCount = project.signals.filter(
    (signal) => signal.severity === "critical",
  ).length;
  const highCount = project.signals.filter(
    (signal) => signal.severity === "high",
  ).length;
  const mediumCount = project.signals.filter(
    (signal) => signal.severity === "medium",
  ).length;

  const rawPenalty = criticalCount * 5 + highCount * 3 + mediumCount * 1;
  const scaledPenalty = rawPenalty / Math.max(1, project.sessionCount);
  return Math.max(5, Math.min(100, Math.round(100 - scaledPenalty * 8)));
};

export const renderAnalyzeOutput = async (
  report: AnalysisReport,
): Promise<string> => {
  const lines: string[] = [];

  lines.push(`${BOLD}Claude Optimizer${RESET}  ${DIM}${report.totalProjects} projects · ${report.totalSessions} sessions${RESET}`);
  lines.push("");

  const projectsToShow = report.projects.slice(0, REPORT_PROJECT_LIMIT);

  for (const project of projectsToShow) {
    const healthPercentage = scoreToHealthPercentage(project);
    const displayName = truncateProjectName(project.projectName);
    const percentLabel = `${healthPercentage}%`.padStart(BAR_LABEL_WIDTH);

    const barColor =
      healthPercentage >= HEALTH_GOOD_THRESHOLD ? GREEN
        : healthPercentage >= HEALTH_FAIR_THRESHOLD ? YELLOW
          : RED;

    const barWidth = 25;
    const filled = Math.round((healthPercentage / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = `${barColor}${"█".repeat(filled)}${RESET}${DIM}${"░".repeat(empty)}${RESET}`;

    lines.push(`  ${BOLD}${displayName}${RESET} ${bar} ${barColor}${percentLabel}${RESET}`);

    if (project.signals.length > 0) {
      const byType = new Map<string, number>();
      for (const signal of project.signals) {
        byType.set(signal.signalName, (byType.get(signal.signalName) ?? 0) + 1);
      }

      const tags = [...byType.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4)
        .map(([name, count]) => {
          const tagColor =
            project.signals.find((signal) => signal.signalName === name)?.severity === "critical" ? RED
              : project.signals.find((signal) => signal.signalName === name)?.severity === "high" ? YELLOW
                : DIM;
          return `${tagColor}${name}${RESET}${DIM}(${count})${RESET}`;
        })
        .join(`${DIM} · ${RESET}`);

      lines.push(`  ${"".padEnd(PROJECT_NAME_WIDTH)} ${DIM}${project.sessionCount} sessions${RESET} ${DIM}·${RESET} ${tags}`);
    } else {
      lines.push(`  ${"".padEnd(PROJECT_NAME_WIDTH)} ${DIM}${project.sessionCount} sessions · no issues${RESET}`);
    }

    lines.push("");
  }

  if (report.projects.length > REPORT_PROJECT_LIMIT) {
    lines.push(
      `  ${DIM}… and ${report.projects.length - REPORT_PROJECT_LIMIT} more projects${RESET}`,
    );
    lines.push("");
  }

  if (report.suggestions.length > 0) {
    lines.push(`${BOLD}Suggested AGENTS.md rules${RESET}`);
    lines.push("");
    for (const suggestion of report.suggestions) {
      lines.push(`  ${YELLOW}→${RESET} ${suggestion}`);
    }
  }

  return lines.join("\n");
};
