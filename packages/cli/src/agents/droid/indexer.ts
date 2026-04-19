import * as fs from "node:fs";
import * as path from "node:path";
import { DROID_SESSIONS_DIR } from "./constants.js";
import { ensureNormalizedSession, readDroidSessionHeader } from "./normalize.js";
import { buildSessionMetadata } from "../../indexer.js";

interface DroidSessionEntry {
  sessionPath: string;
  sessionId: string;
  cwd: string;
  timestamp: string;
}

const walkSessions = (dir: string, results: string[]): void => {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkSessions(fullPath, results);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.endsWith(".settings.json")) {
      results.push(fullPath);
    }
  }
};

export const discoverDroidSessions = async (): Promise<DroidSessionEntry[]> => {
  const sessionPaths: string[] = [];
  walkSessions(DROID_SESSIONS_DIR, sessionPaths);

  const entries: DroidSessionEntry[] = [];
  for (const sessionPath of sessionPaths) {
    const header = await readDroidSessionHeader(sessionPath);
    if (!header) continue;
    entries.push({
      sessionPath,
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

export const indexDroidProjects = async (projectFilter?: string): Promise<ProjectMetadata[]> => {
  const sessions = await discoverDroidSessions();
  const grouped = new Map<string, DroidSessionEntry[]>();

  for (const session of sessions) {
    const cwd = session.cwd || "unknown";
    if (projectFilter && !cwd.includes(projectFilter)) continue;
    const existing = grouped.get(cwd) ?? [];
    existing.push(session);
    grouped.set(cwd, existing);
  }

  const projects: ProjectMetadata[] = [];

  for (const [cwd, sessionEntries] of grouped) {
    const projectSessions: SessionMetadata[] = [];

    for (const session of sessionEntries) {
      try {
        const cachedPath = await ensureNormalizedSession(session.sessionPath, {
          sessionId: session.sessionId,
          cwd: session.cwd,
          timestamp: session.timestamp,
        });
        const metadata = await buildSessionMetadata(cachedPath, cwd, sanitizeProjectName(cwd));
        projectSessions.push(metadata);
      } catch {
        /* skip unreadable session */
      }
    }

    if (projectSessions.length === 0) continue;

    projectSessions.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

    projects.push({
      projectPath: cwd,
      projectName: sanitizeProjectName(cwd),
      sessions: projectSessions,
      totalSessions: projectSessions.length,
    });
  }

  projects.sort((left, right) => right.totalSessions - left.totalSessions);
  return projects;
};

export const findDroidSession = async (
  sessionArg: string,
  projectFilter?: string,
): Promise<{ sessionPath: string; sessionId: string; cwd: string } | undefined> => {
  if (sessionArg.includes("/") || sessionArg.endsWith(".jsonl")) {
    const header = await readDroidSessionHeader(sessionArg);
    if (!header) return undefined;

    return {
      sessionPath: sessionArg,
      sessionId: header.sessionId,
      cwd: header.cwd,
    };
  }

  const sessions = await discoverDroidSessions();
  const match = sessions.find((session) => session.sessionId === sessionArg);
  if (!match) return undefined;
  if (projectFilter && !match.cwd.includes(projectFilter)) return undefined;

  return {
    sessionPath: match.sessionPath,
    sessionId: match.sessionId,
    cwd: match.cwd,
  };
};

export const findLatestDroidSession = async (
  projectFilter?: string,
): Promise<{ sessionPath: string; sessionId: string; cwd: string } | undefined> => {
  const sessions = await discoverDroidSessions();
  const filtered = projectFilter
    ? sessions.filter((session) => session.cwd.includes(projectFilter))
    : sessions;

  if (filtered.length === 0) return undefined;

  const latest = filtered.reduce((latestSession, currentSession) =>
    new Date(currentSession.timestamp).getTime() > new Date(latestSession.timestamp).getTime()
      ? currentSession
      : latestSession,
  );

  return {
    sessionPath: latest.sessionPath,
    sessionId: latest.sessionId,
    cwd: latest.cwd,
  };
};
