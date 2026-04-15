import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  CLAUDE_PROJECTS_DIR,
  MODEL_TOP_ISSUES_LIMIT,
  SAVED_MODEL_VERSION,
} from "./constants.js";
import {
  analyzeSessionSentiment,
  sentimentToSignals,
} from "./signals/sentiment.js";
import { detectThrashing } from "./signals/thrashing.js";
import { detectErrorLoops } from "./signals/error-loops.js";
import { detectToolInefficiency } from "./signals/tool-efficiency.js";
import { detectBehavioralSignals } from "./signals/behavioral.js";

const MODEL_DIR = ".claude-optimizer";
const MODEL_FILE = "model.json";
const GUIDANCE_FILE = "guidance.md";

export const getModelDir = (projectRoot?: string): string => {
  const root = projectRoot ?? process.cwd();
  return path.join(root, MODEL_DIR);
};

export const saveModel = (
  report: AnalysisReport,
  projectRoot?: string,
): string => {
  const modelDir = getModelDir(projectRoot);
  fs.mkdirSync(modelDir, { recursive: true });

  const signalBaselines: Record<string, number> = {};
  for (const signal of report.topSignals) {
    signalBaselines[signal.signalName] =
      (signalBaselines[signal.signalName] ?? 0) + 1;
  }

  const projects: ProjectProfile[] = report.projects.map((project) => {
    const signalFrequency: Record<string, number> = {};
    for (const signal of project.signals) {
      signalFrequency[signal.signalName] =
        (signalFrequency[signal.signalName] ?? 0) + 1;
    }

    return {
      projectPath: project.projectPath,
      sessionCount: project.sessionCount,
      overallScore: project.overallScore,
      signalFrequency,
      topIssues: project.signals
        .sort((left, right) => left.score - right.score)
        .slice(0, MODEL_TOP_ISSUES_LIMIT)
        .map((signal) => signal.details),
      suggestions: [],
    };
  });

  const model: SavedModel = {
    version: SAVED_MODEL_VERSION,
    savedAt: new Date().toISOString(),
    totalSessions: report.totalSessions,
    totalProjects: report.totalProjects,
    signalBaselines,
    projects,
    globalSuggestions: report.suggestions,
  };

  const modelPath = path.join(modelDir, MODEL_FILE);
  fs.writeFileSync(modelPath, JSON.stringify(model, null, 2));

  const guidancePath = path.join(modelDir, GUIDANCE_FILE);
  const guidance = buildGuidanceDoc(model);
  fs.writeFileSync(guidancePath, guidance);

  return modelDir;
};

export const loadModel = (projectRoot?: string): SavedModel | undefined => {
  const modelPath = path.join(getModelDir(projectRoot), MODEL_FILE);
  if (!fs.existsSync(modelPath)) return undefined;
  const content = fs.readFileSync(modelPath, "utf-8");
  return JSON.parse(content) as SavedModel;
};

const buildGuidanceDoc = (model: SavedModel): string => {
  const lines: string[] = [];

  lines.push("# Claude Optimizer — Session Guidance");
  lines.push("");
  lines.push(
    `Based on analysis of ${model.totalSessions} sessions across ${model.totalProjects} projects.`,
  );
  lines.push(`Last updated: ${model.savedAt}`);
  lines.push("");
  lines.push("## Known Issues");
  lines.push("");

  for (const suggestion of model.globalSuggestions) {
    lines.push(`- ${suggestion}`);
  }

  lines.push("");
  lines.push("## Rules for This Session");
  lines.push("");
  lines.push(
    "If you notice yourself exhibiting any of these patterns, STOP and course-correct:",
  );
  lines.push("");

  const hasSignal = (name: string) =>
    (model.signalBaselines[name] ?? 0) > 0;

  if (hasSignal("edit-thrashing")) {
    lines.push(
      "- **STOP re-editing the same file repeatedly.** Read the full file, plan your changes, then make ONE complete edit. If you've edited a file 3+ times, pause and re-read the user's requirements.",
    );
  }

  if (hasSignal("error-loop")) {
    lines.push(
      "- **STOP retrying the same failing command.** After 2 consecutive tool failures, change your approach entirely. Explain what failed and try a different strategy.",
    );
  }

  if (hasSignal("correction-heavy") || hasSignal("negative-sentiment")) {
    lines.push(
      "- **STOP and re-read the user's message** if they correct you. Don't guess — quote back what they asked for and confirm before proceeding.",
    );
  }

  if (hasSignal("keep-going-loop")) {
    lines.push(
      "- **Don't stop early.** Complete the FULL task before presenting results. If the user asked for 4 features, implement all 4 before stopping.",
    );
  }

  if (hasSignal("negative-drift")) {
    lines.push(
      "- **Re-check original requirements** every few turns. Sessions degrade when you lose track of the goal. Periodically refer back to the first user message.",
    );
  }

  if (hasSignal("rapid-corrections")) {
    lines.push(
      "- **Double-check your output before presenting it.** Users have been correcting within seconds — your first attempts are often obviously wrong. Verify before responding.",
    );
  }

  if (hasSignal("repeated-instructions")) {
    lines.push(
      "- **Follow through on instructions fully.** Users have had to repeat themselves. When given an instruction, confirm you understood it and act on it completely.",
    );
  }

  if (hasSignal("excessive-exploration")) {
    lines.push(
      "- **Act sooner.** Don't read 10 files before making a change. Get a basic understanding, make the change, then iterate.",
    );
  }

  lines.push("");

  return lines.join("\n");
};

export const checkSession = async (
  sessionFilePath: string,
  sessionId: string,
  savedModel?: SavedModel,
): Promise<CheckResult> => {
  const signals: SignalResult[] = [];

  const sentiment = await analyzeSessionSentiment(sessionFilePath, sessionId);
  signals.push(...sentimentToSignals(sentiment));

  const thrashingSignals = await detectThrashing(sessionFilePath, sessionId);
  signals.push(...thrashingSignals);

  const errorLoopSignals = await detectErrorLoops(sessionFilePath, sessionId);
  signals.push(...errorLoopSignals);

  const efficiencySignals = await detectToolInefficiency(
    sessionFilePath,
    sessionId,
  );
  signals.push(...efficiencySignals);

  const behavioralSignals = await detectBehavioralSignals(
    sessionFilePath,
    sessionId,
  );
  signals.push(...behavioralSignals);

  const guidance = buildSessionGuidance(signals, savedModel);

  const isHealthy =
    signals.filter(
      (signal) =>
        signal.severity === "critical" || signal.severity === "high",
    ).length === 0;

  return {
    sessionId,
    isHealthy,
    activeSignals: signals,
    guidance,
  };
};

const buildSessionGuidance = (
  signals: SignalResult[],
  savedModel?: SavedModel,
): string[] => {
  const guidance: string[] = [];

  const signalNames = new Set(signals.map((signal) => signal.signalName));

  if (signalNames.has("edit-thrashing")) {
    guidance.push(
      "You are re-editing the same file repeatedly. Stop, re-read the full file and the user's requirements, then make one complete change.",
    );
  }

  if (signalNames.has("error-loop")) {
    guidance.push(
      "You are in an error loop — the same tool keeps failing. Change your approach entirely instead of retrying.",
    );
  }

  if (signalNames.has("correction-heavy")) {
    guidance.push(
      "The user is frequently correcting you. Re-read their last message carefully and confirm your understanding before proceeding.",
    );
  }

  if (signalNames.has("keep-going-loop")) {
    guidance.push(
      "The user keeps asking you to continue. Complete the full task before stopping — don't present partial work.",
    );
  }

  if (signalNames.has("negative-drift")) {
    guidance.push(
      "This session is degrading. Re-read the original request and make sure you haven't drifted from the goal.",
    );
  }

  if (signalNames.has("rapid-corrections")) {
    guidance.push(
      "The user is correcting you immediately. Slow down and verify your output before presenting it.",
    );
  }

  if (signalNames.has("repeated-instructions")) {
    guidance.push(
      "The user is repeating themselves. You may have missed or ignored an instruction. Re-read the conversation history.",
    );
  }

  if (signalNames.has("negative-sentiment") || signalNames.has("extreme-frustration")) {
    guidance.push(
      "The user is frustrated. Acknowledge the issue, ask clarifying questions if needed, and focus on getting it right this time.",
    );
  }

  if (signalNames.has("user-interrupts")) {
    guidance.push(
      "The user interrupted you. Whatever you were doing was wrong. Stop and ask what they actually want.",
    );
  }

  if (savedModel) {
    const knownBadSignals = Object.keys(savedModel.signalBaselines);
    const matchingHistorical = signals.filter((signal) =>
      knownBadSignals.includes(signal.signalName),
    );
    if (matchingHistorical.length > 0) {
      guidance.push(
        `This session is repeating known issues from past sessions: ${matchingHistorical.map((signal) => signal.signalName).join(", ")}. Check .claude-optimizer/guidance.md for project-specific rules.`,
      );
    }
  }

  return guidance;
};

export const findLatestSession = (
  projectFilter?: string,
): { filePath: string; sessionId: string } | undefined => {
  const projectsDir = path.join(os.homedir(), CLAUDE_PROJECTS_DIR);
  if (!fs.existsSync(projectsDir)) return undefined;

  const projectDirs = fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  let latestTime = 0;
  let latestFile: string | undefined;

  for (const projectDir of projectDirs) {
    if (projectFilter) {
      const decoded = projectDir.replace(/-/g, "/").replace(/^\//, "");
      if (!decoded.includes(projectFilter)) continue;
    }

    const fullDir = path.join(projectsDir, projectDir);
    const files = fs
      .readdirSync(fullDir)
      .filter(
        (fileName) =>
          fileName.endsWith(".jsonl") && !fileName.startsWith("agent-"),
      );

    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latestTime) {
        latestTime = stat.mtimeMs;
        latestFile = filePath;
      }
    }
  }

  if (!latestFile) return undefined;

  return {
    filePath: latestFile,
    sessionId: path.basename(latestFile, ".jsonl"),
  };
};
