import { TOP_SIGNALS_LIMIT } from "../../constants.js";
import { analyzeProject, formatReportJson } from "../../reporter.js";
import { loadModel, saveModel, checkSession } from "../../model.js";
import { generateAgentsRules, generateSuggestions } from "../../suggestions.js";
import { buildSessionTimeline, renderAnalyzeOutput, renderCheckOutput } from "../../viz.js";
import { findLatestPiSession, findPiSession, indexPiProjects } from "./indexer.js";
import { ensureNormalizedSession, readPiSessionHeader } from "./normalize.js";

interface PiRunOptions {
  project?: string;
  rules?: boolean;
  save?: boolean;
  json?: boolean;
  dir?: string;
  onProgress?: (current: number, total: number, projectName: string) => void;
}

const AGENT_NAME = "pi";

export const runPiCheck = async (sessionArg: string, options: PiRunOptions): Promise<string> => {
  let resolved: { sessionPath: string; sessionId: string; cwd: string } | undefined;

  if (sessionArg === "latest") {
    resolved = await findLatestPiSession(options.project);
  } else {
    resolved = await findPiSession(sessionArg, options.project);
  }

  if (!resolved) {
    throw new Error(`Pi session not found: ${sessionArg}`);
  }

  const header = await readPiSessionHeader(resolved.sessionPath);
  if (!header) {
    throw new Error(`Failed to read Pi session header: ${resolved.sessionPath}`);
  }

  const cachedPath = await ensureNormalizedSession(resolved.sessionPath, header);
  const savedModel = loadModel(options.dir, AGENT_NAME);
  const result = await checkSession(cachedPath, resolved.sessionId, savedModel, AGENT_NAME);

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  const { turns, healthPercentage, summary } = await buildSessionTimeline(cachedPath);

  return renderCheckOutput(
    result.sessionId,
    turns,
    healthPercentage,
    summary,
    result.activeSignals,
    result.guidance,
  );
};

export const runPiReport = async (
  options: PiRunOptions,
): Promise<{
  report: AnalysisReport;
  rulesText: string;
  rendered: string;
  modelDir?: string;
}> => {
  const projects = await indexPiProjects(options.project);
  const projectAnalyses: ProjectAnalysis[] = [];

  for (let projectIndex = 0; projectIndex < projects.length; projectIndex++) {
    const project = projects[projectIndex];
    options.onProgress?.(projectIndex + 1, projects.length, project.projectPath);
    const analysis = await analyzeProject(project);
    projectAnalyses.push(analysis);
  }

  projectAnalyses.sort((left, right) => left.overallScore - right.overallScore);

  const allSignals = projectAnalyses.flatMap((projectAnalysis) => projectAnalysis.signals);
  const topSignals = allSignals
    .sort((left, right) => left.score - right.score)
    .slice(0, TOP_SIGNALS_LIMIT);

  const suggestions = generateSuggestions(projectAnalyses);

  const report: AnalysisReport = {
    generatedAt: new Date(),
    totalSessions: projects.reduce((sum, project) => sum + project.totalSessions, 0),
    totalProjects: projects.length,
    projects: projectAnalyses,
    topSignals,
    suggestions,
  };

  let modelDir: string | undefined;
  if (options.save) {
    modelDir = saveModel(report, options.dir, AGENT_NAME);
  }

  const rulesText = generateAgentsRules(report.projects, report.totalSessions);
  if (options.rules) {
    return { report, rulesText, rendered: "", modelDir };
  }

  if (options.json) {
    return {
      report,
      rulesText: "",
      rendered: formatReportJson(report),
      modelDir,
    };
  }

  const rendered = await renderAnalyzeOutput(report);
  return { report, rulesText, rendered, modelDir };
};
