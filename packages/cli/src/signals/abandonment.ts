import {
  ABANDONMENT_WINDOW_MS,
  SHORT_SESSION_THRESHOLD,
  SHORT_SESSION_RATIO_THRESHOLD,
  SHORT_SESSION_RATIO_CRITICAL,
  MIN_SHORT_SESSIONS_TO_FLAG,
  RESTART_CLUSTER_CRITICAL_THRESHOLD,
} from "../constants.js";

export const detectAbandonment = (
  sessions: SessionMetadata[],
): SignalResult[] => {
  const signals: SignalResult[] = [];

  const sorted = [...sessions].sort(
    (left, right) => left.startTime.getTime() - right.startTime.getTime(),
  );

  const clusters: AbandonmentCluster[] = [];
  let currentCluster: AbandonmentCluster | undefined;

  for (let sessionIndex = 0; sessionIndex < sorted.length; sessionIndex++) {
    const session = sorted[sessionIndex];
    const previousSession =
      sessionIndex > 0 ? sorted[sessionIndex - 1] : undefined;

    if (!previousSession) {
      currentCluster = {
        sessionIds: [session.sessionId],
        windowMs: 0,
        startTime: session.startTime,
      };
      continue;
    }

    const timeSincePrevious =
      session.startTime.getTime() - previousSession.startTime.getTime();

    if (timeSincePrevious <= ABANDONMENT_WINDOW_MS) {
      if (currentCluster) {
        currentCluster.sessionIds.push(session.sessionId);
        currentCluster.windowMs =
          session.startTime.getTime() - currentCluster.startTime.getTime();
      }
    } else {
      if (currentCluster && currentCluster.sessionIds.length > 1) {
        clusters.push(currentCluster);
      }
      currentCluster = {
        sessionIds: [session.sessionId],
        windowMs: 0,
        startTime: session.startTime,
      };
    }
  }

  if (currentCluster && currentCluster.sessionIds.length > 1) {
    clusters.push(currentCluster);
  }

  for (const cluster of clusters) {
    const windowMinutes = Math.round(cluster.windowMs / 60_000);
    signals.push({
      signalName: "restart-cluster",
      severity: cluster.sessionIds.length >= RESTART_CLUSTER_CRITICAL_THRESHOLD ? "critical" : "high",
      score: -cluster.sessionIds.length,
      details: `${cluster.sessionIds.length} sessions started within ${windowMinutes} minutes — likely repeated restarts`,
      examples: cluster.sessionIds.slice(0, 5),
    });
  }

  const shortSessions = sorted.filter(
    (session) => session.userMessageCount < SHORT_SESSION_THRESHOLD,
  );
  const shortSessionRatio =
    sorted.length > 0 ? shortSessions.length / sorted.length : 0;

  if (shortSessionRatio > SHORT_SESSION_RATIO_THRESHOLD && shortSessions.length >= MIN_SHORT_SESSIONS_TO_FLAG) {
    signals.push({
      signalName: "high-abandonment-rate",
      severity: shortSessionRatio > SHORT_SESSION_RATIO_CRITICAL ? "critical" : "high",
      score: -Math.round(shortSessionRatio * 10),
      details: `${shortSessions.length}/${sorted.length} sessions (${Math.round(shortSessionRatio * 100)}%) had fewer than ${SHORT_SESSION_THRESHOLD} user messages`,
      examples: shortSessions.slice(0, 5).map((session) => session.sessionId),
    });
  }

  return signals;
};
