import { findDroidSession, findLatestDroidSession, indexDroidProjects } from "./indexer.js";
import { ensureNormalizedSession, readDroidSessionHeader } from "./normalize.js";
import { analyzeProject, formatReportJson } from "../../reporter.js";
import { generateSuggestions, generateAgentsRules } from "../../suggestions.js";
import { saveModel, loadModel, checkSession } from "../../model.js";
import { buildSessionTimeline, renderCheckOutput, renderAnalyzeOutput } from "../../viz.js";
import { TOP_SIGNALS_LIMIT } from "../../constants.js";

interface DroidRunOptions {
  project?: string;
  rules?: boolean;
  save?: boolean;
  json?: boolean;
  dir?: string;
  onProgress?: (current: number, total: number, projectName: string) => void;
}

const AGENT_NAME = "droid";

export const runDroidCheck = async (
  sessionArg: string,
  options: DroidRunOptions,
): Promise<string> => {
  let resolved: { sessionPath: string; sessionId: string; cwd: string } | undefined;

  if (sessionArg === "latest") {
    resolved = await findLatestDroidSession(options.project);
  } else {
    resolved = await findDroidSession(sessionArg, options.project);
  }

  if (!resolved) {
    throw new Error(`Droid session not found: ${sessionArg}`);
  }

  const header = await readDroidSessionHeader(resolved.sessionPath);
  if (!header) {
    throw new Error(`Failed to read Droid session header: ${resolved.sessionPath}`);
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

export const runDroidReport = async (
  options: DroidRunOptions,
): Promise<{
  report: AnalysisReport;
  rulesText: string;
  rendered: string;
  modelDir?: string;
}> => {
  const projects = await indexDroidProjects(options.project);
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
