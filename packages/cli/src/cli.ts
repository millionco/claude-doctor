#!/usr/bin/env node

import { Command } from "commander";
import {
  generateReport,
  formatReportJson,
} from "./reporter.js";
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

const program = new Command();

program
  .name("claude-optimizer")
  .description(
    "Analyze Claude Code transcripts for quality signals and generate AGENTS.md rules",
  )
  .version("0.0.1")
  .option("-p, --project <path>", "Filter to a specific project path")
  .option("-s, --session <path>", "Check a specific session .jsonl file")
  .option("--all", "Analyze all sessions across all projects")
  .option("--rules", "Output AGENTS.md rules text")
  .option("--save", "Save analysis model to .claude-optimizer/")
  .option("--json", "Output as JSON")
  .option(
    "-d, --dir <path>",
    "Project root for .claude-optimizer/",
  )
  .action(
    async (options: {
      project?: string;
      session?: string;
      all?: boolean;
      rules?: boolean;
      save?: boolean;
      json?: boolean;
      dir?: string;
    }) => {
      if (options.all || options.rules || options.save) {
        const report = await generateReport(options.project);

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
        return;
      }

      let sessionFilePath: string;
      let sessionId: string;

      if (options.session) {
        sessionFilePath = options.session;
        sessionId = options.session.replace(/.*\//, "").replace(".jsonl", "");
      } else {
        const latest = findLatestSession(options.project);
        if (!latest) {
          console.error("No sessions found.");
          process.exit(1);
        }
        sessionFilePath = latest.filePath;
        sessionId = latest.sessionId;
      }

      const savedModel = loadModel(options.dir);

      const result = await checkSession(
        sessionFilePath,
        sessionId,
        savedModel,
      );

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const { turns, healthPercentage, summary } =
        await buildSessionTimeline(sessionFilePath);

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
    },
  );

program.parse();
