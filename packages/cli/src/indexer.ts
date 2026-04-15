import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CLAUDE_PROJECTS_DIR } from "./constants.js";
import {
  parseTranscriptFile,
  extractUserMessages,
  extractToolUses,
  extractToolErrors,
  countInterrupts,
  getSessionTimeRange,
} from "./parser.js";

const decodeProjectName = (encodedName: string): string =>
  encodedName.replace(/-/g, "/").replace(/^\//, "");

export const getProjectsDir = (): string =>
  path.join(os.homedir(), CLAUDE_PROJECTS_DIR);

export const discoverProjects = (projectsDir: string): string[] => {
  if (!fs.existsSync(projectsDir)) return [];
  return fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
};

export const discoverSessions = (projectDir: string): string[] =>
  fs
    .readdirSync(projectDir)
    .filter(
      (fileName) =>
        fileName.endsWith(".jsonl") && !fileName.startsWith("agent-"),
    );

export const buildSessionMetadata = async (
  filePath: string,
  projectPath: string,
  projectName: string,
): Promise<SessionMetadata> => {
  const sessionId = path.basename(filePath, ".jsonl");
  const events = await parseTranscriptFile(filePath);
  const userMessages = extractUserMessages(events);
  const toolUses = extractToolUses(events);
  const toolErrorCount = extractToolErrors(events);
  const interruptCount = countInterrupts(events);
  const { start, end } = getSessionTimeRange(events);

  const assistantMessageCount = events.filter(
    (event) => event.type === "assistant",
  ).length;

  return {
    sessionId,
    projectPath,
    projectName,
    filePath,
    startTime: start,
    endTime: end,
    userMessageCount: userMessages.length,
    assistantMessageCount,
    toolCallCount: toolUses.length,
    toolErrorCount,
    interruptCount,
  };
};

export const indexAllProjects = async (
  projectFilter?: string,
): Promise<ProjectMetadata[]> => {
  const projectsDir = getProjectsDir();
  const projectDirs = discoverProjects(projectsDir);
  const projects: ProjectMetadata[] = [];

  for (const encodedName of projectDirs) {
    const decodedName = decodeProjectName(encodedName);

    if (projectFilter && !decodedName.includes(projectFilter)) continue;

    const projectDir = path.join(projectsDir, encodedName);
    const sessionFiles = discoverSessions(projectDir);

    if (sessionFiles.length === 0) continue;

    const sessions: SessionMetadata[] = [];
    for (const sessionFile of sessionFiles) {
      const filePath = path.join(projectDir, sessionFile);
      try {
        const metadata = await buildSessionMetadata(
          filePath,
          decodedName,
          encodedName,
        );
        sessions.push(metadata);
      } catch {
        /* skip unreadable session files */
      }
    }

    sessions.sort(
      (left, right) => left.startTime.getTime() - right.startTime.getTime(),
    );

    projects.push({
      projectPath: decodedName,
      projectName: encodedName,
      sessions,
      totalSessions: sessions.length,
    });
  }

  projects.sort((left, right) => right.totalSessions - left.totalSessions);

  return projects;
};
