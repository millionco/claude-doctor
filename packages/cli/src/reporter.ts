import { indexAllProjects } from "./indexer.js";
import { detectAbandonment } from "./signals/abandonment.js";
import {
  analyzeSessionSentiment,
  sentimentToSignals,
} from "./signals/sentiment.js";
import { detectThrashing } from "./signals/thrashing.js";
import { detectErrorLoops } from "./signals/error-loops.js";
import { detectToolInefficiency } from "./signals/tool-efficiency.js";
import { detectBehavioralSignals } from "./signals/behavioral.js";
import { generateSuggestions } from "./suggestions.js";
import {
  SEVERITY_WEIGHT_CRITICAL,
  SEVERITY_WEIGHT_HIGH,
  SEVERITY_WEIGHT_MEDIUM,
  SEVERITY_WEIGHT_LOW,
  TOP_SIGNALS_LIMIT,
  REPORT_PROJECT_LIMIT,
  REPORT_SIGNAL_DISPLAY_LIMIT,
  EXAMPLE_TRUNCATE_LENGTH,
} from "./constants.js";

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: SEVERITY_WEIGHT_CRITICAL,
  high: SEVERITY_WEIGHT_HIGH,
  medium: SEVERITY_WEIGHT_MEDIUM,
  low: SEVERITY_WEIGHT_LOW,
};

export const analyzeProject = async (
  project: ProjectMetadata,
): Promise<ProjectAnalysis> => {
  const signals: SignalResult[] = [];

  const abandonmentSignals = detectAbandonment(project.sessions);
  signals.push(...abandonmentSignals);

  for (const session of project.sessions) {
    const sentiment = await analyzeSessionSentiment(
      session.filePath,
      session.sessionId,
    );
    signals.push(...sentimentToSignals(sentiment));

    const thrashingSignals = await detectThrashing(
      session.filePath,
      session.sessionId,
    );
    signals.push(...thrashingSignals);

    const errorLoopSignals = await detectErrorLoops(
      session.filePath,
      session.sessionId,
    );
    signals.push(...errorLoopSignals);

    const efficiencySignals = await detectToolInefficiency(
      session.filePath,
      session.sessionId,
    );
    signals.push(...efficiencySignals);

    const behavioralSignals = await detectBehavioralSignals(
      session.filePath,
      session.sessionId,
    );
    signals.push(...behavioralSignals);
  }

  signals.sort((left, right) => left.score - right.score);

  const overallScore =
    signals.length > 0
      ? signals.reduce(
          (sum, signal) => sum + signal.score * SEVERITY_WEIGHTS[signal.severity],
          0,
        ) / project.totalSessions
      : 0;

  return {
    projectName: project.projectPath,
    projectPath: project.projectPath,
    sessionCount: project.totalSessions,
    signals,
    overallScore,
  };
};

export const generateReport = async (
  projectFilter?: string,
): Promise<AnalysisReport> => {
  const projects = await indexAllProjects(projectFilter);
  const projectAnalyses: ProjectAnalysis[] = [];

  for (const project of projects) {
    const analysis = await analyzeProject(project);
    projectAnalyses.push(analysis);
  }

  projectAnalyses.sort((left, right) => left.overallScore - right.overallScore);

  const allSignals = projectAnalyses.flatMap(
    (projectAnalysis) => projectAnalysis.signals,
  );
  const topSignals = allSignals
    .sort((left, right) => left.score - right.score)
    .slice(0, TOP_SIGNALS_LIMIT);

  const suggestions = generateSuggestions(projectAnalyses);

  return {
    generatedAt: new Date(),
    totalSessions: projects.reduce(
      (sum, project) => sum + project.totalSessions,
      0,
    ),
    totalProjects: projects.length,
    projects: projectAnalyses,
    topSignals,
    suggestions,
  };
};

export const formatReportMarkdown = (report: AnalysisReport): string => {
  const lines: string[] = [];

  lines.push("# Claude Optimizer Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt.toISOString()}  `);
  lines.push(`Projects: ${report.totalProjects} | Sessions: ${report.totalSessions}`);
  lines.push("");
  lines.push("## Top Signals");
  lines.push("");

  if (report.topSignals.length === 0) {
    lines.push("No significant signals detected.");
  } else {
    for (const signal of report.topSignals.slice(0, REPORT_SIGNAL_DISPLAY_LIMIT)) {
      const severityBadge =
        signal.severity === "critical"
          ? "CRIT"
          : signal.severity === "high"
            ? "HIGH"
            : signal.severity === "medium"
              ? "MED"
              : "LOW";
      lines.push(`- **[${severityBadge}]** ${signal.signalName}: ${signal.details}`);
      if (signal.examples && signal.examples.length > 0) {
        for (const example of signal.examples.slice(0, 3)) {
          const truncated =
            example.length > EXAMPLE_TRUNCATE_LENGTH
              ? example.slice(0, EXAMPLE_TRUNCATE_LENGTH) + "..."
              : example;
          lines.push(`  - \`${truncated}\``);
        }
      }
    }
  }

  lines.push("");
  lines.push("## Projects (worst first)");
  lines.push("");

  for (const project of report.projects.slice(0, REPORT_PROJECT_LIMIT)) {
    const signalCount = project.signals.length;
    const criticalCount = project.signals.filter(
      (signal) => signal.severity === "critical",
    ).length;

    lines.push(
      `### ${project.projectName} (${project.sessionCount} sessions, score: ${project.overallScore.toFixed(1)})`,
    );
    lines.push("");

    if (signalCount === 0) {
      lines.push("No significant signals.");
    } else {
      lines.push(`${signalCount} signals (${criticalCount} critical)`);
      lines.push("");

      const byType = new Map<string, SignalResult[]>();
      for (const signal of project.signals) {
        const existing = byType.get(signal.signalName) ?? [];
        existing.push(signal);
        byType.set(signal.signalName, existing);
      }

      for (const [signalName, signalList] of byType) {
        const worstScore = Math.min(
          ...signalList.map((signal) => signal.score),
        );
        lines.push(`- **${signalName}** x${signalList.length} (worst: ${worstScore})`);
      }
    }

    lines.push("");
  }

  if (report.suggestions.length > 0) {
    lines.push("## Suggestions for AGENTS.md");
    lines.push("");
    for (const suggestion of report.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

export const formatReportJson = (report: AnalysisReport): string =>
  JSON.stringify(report, null, 2);
