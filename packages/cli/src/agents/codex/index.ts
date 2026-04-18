import {
  indexCodexProjects,
  findLatestCodexSession,
  findCodexSession,
} from "./indexer.js";
import {
  ensureNormalizedSession,
  readCodexSessionHeader,
} from "./normalize.js";
import { analyzeProject, formatReportJson } from "../../reporter.js";
import { generateSuggestions, generateAgentsRules } from "../../suggestions.js";
import { saveModel, loadModel, checkSession } from "../../model.js";
import {
  buildSessionTimeline,
  renderCheckOutput,
  renderAnalyzeOutput,
} from "../../viz.js";
import { TOP_SIGNALS_LIMIT } from "../../constants.js";

interface CodexRunOptions {
  session?: string;
  project?: string;
  rules?: boolean;
  save?: boolean;
  json?: boolean;
  dir?: string;
  onProgress?: (current: number, total: number, projectName: string) => void;
}

const AGENT_NAME = "codex";

export const runCodexCheck = async (
  sessionArg: string,
  options: CodexRunOptions,
): Promise<string> => {
  let resolved:
    | { rolloutPath: string; sessionId: string; cwd: string }
    | undefined;

  if (sessionArg === "latest") {
    resolved = await findLatestCodexSession(options.project);
  } else {
    resolved = await findCodexSession(sessionArg, options.project);
  }

  if (!resolved) {
    throw new Error(`Codex session not found: ${sessionArg}`);
  }

  const header = await readCodexSessionHeader(resolved.rolloutPath);
  if (!header) {
    throw new Error(
      `Failed to read Codex session header: ${resolved.rolloutPath}`,
    );
  }

  const cachedPath = await ensureNormalizedSession(
    resolved.rolloutPath,
    header,
  );
  const savedModel = loadModel(options.dir, AGENT_NAME);
  const result = await checkSession(cachedPath, resolved.sessionId, savedModel);

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  const { turns, healthPercentage, summary } =
    await buildSessionTimeline(cachedPath);

  return renderCheckOutput(
    result.sessionId,
    turns,
    healthPercentage,
    summary,
    result.activeSignals,
    result.guidance,
  );
};

export const runCodexReport = async (
  options: CodexRunOptions,
): Promise<{
  report: AnalysisReport;
  rulesText: string;
  rendered: string;
  modelDir?: string;
}> => {
  const projects = await indexCodexProjects(options.project);
  const projectAnalyses: ProjectAnalysis[] = [];

  for (let projectIndex = 0; projectIndex < projects.length; projectIndex++) {
    const project = projects[projectIndex];
    options.onProgress?.(
      projectIndex + 1,
      projects.length,
      project.projectPath,
    );
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

  const report: AnalysisReport = {
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

  const rulesText = generateAgentsRules(report.projects, report.totalSessions);
  const rendered = await renderAnalyzeOutput(report);

  let modelDir: string | undefined;
  if (options.save) {
    modelDir = saveModel(report, options.dir, AGENT_NAME);
  }

  if (options.json) {
    return { report, rulesText, rendered: formatReportJson(report), modelDir };
  }

  return { report, rulesText, rendered, modelDir };
};
