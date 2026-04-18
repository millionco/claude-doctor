#!/usr/bin/env node

import { Command } from "commander";
import { generateReport, formatReportJson } from "./reporter.js";
import {
  saveModel,
  loadModel,
  checkSession,
  findLatestSession,
} from "./model.js";
import {
  buildSessionTimeline,
  renderCheckOutput,
  renderAnalyzeOutput,
} from "./viz.js";
import { generateAgentsRules } from "./suggestions.js";
import { runCodexCheck, runCodexReport } from "./agents/codex/index.js";

const SUPPORTED_AGENTS = ["claude", "codex"] as const;
type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

const isSupportedAgent = (value: string): value is SupportedAgent =>
  (SUPPORTED_AGENTS as readonly string[]).includes(value);

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const createSpinner = () => {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let currentMessage = "";

  const render = () => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    process.stderr.write(`\r${DIM}${frame} ${currentMessage}${RESET}\x1b[K`);
    frameIndex++;
  };

  return {
    start: (message: string) => {
      currentMessage = message;
      render();
      intervalId = setInterval(render, 80);
    },
    update: (message: string) => {
      currentMessage = message;
    },
    stop: () => {
      if (intervalId) clearInterval(intervalId);
      process.stderr.write("\r\x1b[K");
    },
  };
};

const program = new Command();

program
  .name("claude-doctor")
  .description(
    "Diagnose your agent sessions (Claude by default; `codex` also supported). Analyzes transcripts for behavioral anti-patterns and generates rules for CLAUDE.md / AGENTS.md.",
  )
  .version("0.0.1")
  .argument(
    "[agent-or-session]",
    "Agent name (claude, codex) or session ID / .jsonl path when using default agent",
  )
  .argument(
    "[session]",
    "Session ID or .jsonl path to check a specific session (when first arg is an agent name)",
  )
  .option("-a, --agent <name>", "Agent to analyze (claude, codex)", "claude")
  .option("-p, --project <path>", "Filter to a specific project path")
  .option("--rules", "Output rules for CLAUDE.md / AGENTS.md")
  .option("--save", "Save analysis model to .claude-doctor/")
  .option("--json", "Output as JSON")
  .option("-d, --dir <path>", "Project root for .claude-doctor/")
  .action(
    async (
      firstArg: string | undefined,
      secondArg: string | undefined,
      options: {
        agent?: string;
        project?: string;
        rules?: boolean;
        save?: boolean;
        json?: boolean;
        dir?: string;
      },
    ) => {
      let agent: string = options.agent as string;
      let sessionArg: string | undefined;

      if (firstArg && isSupportedAgent(firstArg)) {
        agent = firstArg;
        sessionArg = secondArg;
      } else {
        sessionArg = firstArg;
        if (secondArg) {
          console.error(
            `Unexpected positional argument: ${secondArg}. Did you mean \`claude-doctor <agent> ${secondArg}\`?`,
          );
          process.exit(1);
        }
      }

      if (!isSupportedAgent(agent)) {
        console.error(
          `Unknown agent: ${agent}. Supported: ${SUPPORTED_AGENTS.join(", ")}.`,
        );
        process.exit(1);
      }

      if (agent === "codex") {
        await runCodexFlow(sessionArg, options);
        return;
      }

      if (sessionArg) {
        const spinner = createSpinner();
        spinner.start("Checking session…");

        const isFilePath =
          sessionArg.includes("/") || sessionArg.endsWith(".jsonl");
        let sessionFilePath: string;
        let sessionId: string;

        if (isFilePath) {
          sessionFilePath = sessionArg;
          sessionId = sessionArg.replace(/.*\//, "").replace(".jsonl", "");
        } else {
          const latest = findLatestSession(options.project);
          if (!latest) {
            spinner.stop();
            console.error("No sessions found.");
            process.exit(1);
          }
          const sessionDir = latest.filePath.replace(/\/[^/]+$/, "");
          sessionFilePath = `${sessionDir}/${sessionArg}.jsonl`;
          sessionId = sessionArg;
        }

        const savedModel = loadModel(options.dir);
        const result = await checkSession(
          sessionFilePath,
          sessionId,
          savedModel,
        );

        if (options.json) {
          spinner.stop();
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const { turns, healthPercentage, summary } =
          await buildSessionTimeline(sessionFilePath);

        spinner.stop();

        console.log(
          renderCheckOutput(
            result.sessionId,
            turns,
            healthPercentage,
            summary,
            result.activeSignals,
            result.guidance,
          ),
        );
        return;
      }

      const spinner = createSpinner();
      spinner.start("Scanning transcripts…");

      const report = await generateReport(
        options.project,
        (current, total, projectName) => {
          const shortName = projectName.replace(
            /^Users\/[^/]+\/Developer\//,
            "",
          );
          spinner.update(`Analyzing ${shortName} (${current}/${total})`);
        },
      );

      spinner.stop();

      if (options.save) {
        const modelDir = saveModel(report, options.dir);
        console.log(
          `Model saved to ${modelDir}/ (${report.totalSessions} sessions, ${report.totalProjects} projects)`,
        );
        console.log("");
      }

      if (options.rules) {
        const rulesText = generateAgentsRules(
          report.projects,
          report.totalSessions,
        );
        if (rulesText) {
          console.log(rulesText);
        } else {
          console.log("No rules to generate — sessions look healthy.");
        }
        return;
      }

      if (options.json) {
        console.log(formatReportJson(report));
        return;
      }

      console.log(await renderAnalyzeOutput(report));
    },
  );

const runCodexFlow = async (
  sessionArg: string | undefined,
  options: {
    project?: string;
    rules?: boolean;
    save?: boolean;
    json?: boolean;
    dir?: string;
  },
): Promise<void> => {
  if (sessionArg) {
    const spinner = createSpinner();
    spinner.start("Checking Codex session…");
    try {
      const output = await runCodexCheck(sessionArg, {
        project: options.project,
        json: options.json,
        dir: options.dir,
      });
      spinner.stop();
      console.log(output);
    } catch (error) {
      spinner.stop();
      console.error((error as Error).message);
      process.exit(1);
    }
    return;
  }

  const spinner = createSpinner();
  spinner.start("Scanning Codex transcripts…");

  const { report, rulesText, rendered, modelDir } = await runCodexReport({
    project: options.project,
    rules: options.rules,
    save: options.save,
    json: options.json,
    dir: options.dir,
    onProgress: (current, total, projectName) => {
      const shortName = projectName.replace(/^Users-[^-]+-Developer-/, "");
      spinner.update(`Analyzing ${shortName} (${current}/${total})`);
    },
  });

  spinner.stop();

  if (modelDir) {
    console.log(
      `Model saved to ${modelDir}/ (${report.totalSessions} sessions, ${report.totalProjects} projects)`,
    );
    console.log("");
  }

  if (options.rules) {
    if (rulesText) {
      console.log(rulesText);
    } else {
      console.log("No rules to generate — sessions look healthy.");
    }
    return;
  }

  console.log(rendered);
};

program.parse();
