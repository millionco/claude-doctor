import * as fs from "node:fs";
import * as path from "node:path";
import { CODEX_SESSIONS_DIR } from "./constants.js";
import {
  ensureNormalizedSession,
  readCodexSessionHeader,
} from "./normalize.js";
import { buildSessionMetadata } from "../../indexer.js";

interface CodexRolloutEntry {
  rolloutPath: string;
  sessionId: string;
  cwd: string;
  timestamp: string;
}

const walkRollouts = (dir: string, results: string[]): void => {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRollouts(fullPath, results);
    } else if (
      entry.isFile() &&
      entry.name.startsWith("rollout-") &&
      entry.name.endsWith(".jsonl")
    ) {
      results.push(fullPath);
    }
  }
};

export const discoverCodexRollouts = async (): Promise<CodexRolloutEntry[]> => {
  const rolloutPaths: string[] = [];
  walkRollouts(CODEX_SESSIONS_DIR, rolloutPaths);

  const entries: CodexRolloutEntry[] = [];
  for (const rolloutPath of rolloutPaths) {
    const header = await readCodexSessionHeader(rolloutPath);
    if (!header) continue;
    entries.push({
      rolloutPath,
      sessionId: header.sessionId,
      cwd: header.cwd,
      timestamp: header.timestamp,
    });
  }
  return entries;
};

const sanitizeProjectName = (cwd: string): string => {
  if (!cwd) return "unknown";
  return cwd.replace(/^\//, "").replace(/\//g, "-");
};

export const indexCodexProjects = async (
  projectFilter?: string,
): Promise<ProjectMetadata[]> => {
  const rollouts = await discoverCodexRollouts();
  const grouped = new Map<string, CodexRolloutEntry[]>();

  for (const rollout of rollouts) {
    const cwd = rollout.cwd || "unknown";
    if (projectFilter && !cwd.includes(projectFilter)) continue;
    const existing = grouped.get(cwd) ?? [];
    existing.push(rollout);
    grouped.set(cwd, existing);
  }

  const projects: ProjectMetadata[] = [];

  for (const [cwd, rolloutEntries] of grouped) {
    const sessions: SessionMetadata[] = [];

    for (const rollout of rolloutEntries) {
      try {
        const cachedPath = await ensureNormalizedSession(rollout.rolloutPath, {
          sessionId: rollout.sessionId,
          cwd: rollout.cwd,
          timestamp: rollout.timestamp,
        });
        const metadata = await buildSessionMetadata(
          cachedPath,
          cwd,
          sanitizeProjectName(cwd),
        );
        sessions.push(metadata);
      } catch {
        /* skip unreadable rollout */
      }
    }

    if (sessions.length === 0) continue;

    sessions.sort(
      (left, right) => left.startTime.getTime() - right.startTime.getTime(),
    );

    projects.push({
      projectPath: cwd,
      projectName: sanitizeProjectName(cwd),
      sessions,
      totalSessions: sessions.length,
    });
  }

  projects.sort((left, right) => right.totalSessions - left.totalSessions);
  return projects;
};

export const findCodexSession = async (
  sessionArg: string,
  projectFilter?: string,
): Promise<
  { rolloutPath: string; sessionId: string; cwd: string } | undefined
> => {
  if (sessionArg.includes("/") || sessionArg.endsWith(".jsonl")) {
    const header = await readCodexSessionHeader(sessionArg);
    if (!header) return undefined;
    return {
      rolloutPath: sessionArg,
      sessionId: header.sessionId,
      cwd: header.cwd,
    };
  }

  const rollouts = await discoverCodexRollouts();
  const match = rollouts.find((rollout) => rollout.sessionId === sessionArg);
  if (!match) return undefined;
  if (projectFilter && !match.cwd.includes(projectFilter)) return undefined;
  return {
    rolloutPath: match.rolloutPath,
    sessionId: match.sessionId,
    cwd: match.cwd,
  };
};

export const findLatestCodexSession = async (
  projectFilter?: string,
): Promise<
  { rolloutPath: string; sessionId: string; cwd: string } | undefined
> => {
  const rollouts = await discoverCodexRollouts();
  const filtered = projectFilter
    ? rollouts.filter((rollout) => rollout.cwd.includes(projectFilter))
    : rollouts;
  if (filtered.length === 0) return undefined;

  let latest = filtered[0];
  let latestMs = new Date(latest.timestamp).getTime();
  for (const rollout of filtered) {
    const time = new Date(rollout.timestamp).getTime();
    if (time > latestMs) {
      latest = rollout;
      latestMs = time;
    }
  }
  return {
    rolloutPath: latest.rolloutPath,
    sessionId: latest.sessionId,
    cwd: latest.cwd,
  };
};
