import { describe, it, expect } from "vite-plus/test";
import { detectAbandonment } from "../src/signals/abandonment.js";

const makeSession = (
  sessionId: string,
  startMinutesOffset: number,
  userMessageCount: number,
): SessionMetadata => ({
  sessionId,
  projectPath: "/test/project",
  projectName: "test-project",
  filePath: `/tmp/${sessionId}.jsonl`,
  startTime: new Date(Date.UTC(2026, 3, 1, 10, startMinutesOffset, 0)),
  endTime: new Date(Date.UTC(2026, 3, 1, 10, startMinutesOffset + 5, 0)),
  userMessageCount,
  assistantMessageCount: userMessageCount,
  toolCallCount: userMessageCount * 2,
  toolErrorCount: 0,
  interruptCount: 0,
});

describe("detectAbandonment", () => {
  it("returns no signals for well-spaced sessions", () => {
    const sessions = [
      makeSession("s1", 0, 10),
      makeSession("s2", 60, 10),
      makeSession("s3", 120, 10),
    ];
    const signals = detectAbandonment(sessions);
    expect(signals.length).toBe(0);
  });

  it("detects a restart cluster within 30 minutes", () => {
    const sessions = [
      makeSession("s1", 0, 1),
      makeSession("s2", 5, 1),
      makeSession("s3", 10, 1),
      makeSession("s4", 15, 1),
    ];
    const signals = detectAbandonment(sessions);
    const clusterSignals = signals.filter((signal) => signal.signalName === "restart-cluster");
    expect(clusterSignals.length).toBe(1);
    expect(clusterSignals[0].score).toBe(-4);
  });

  it("marks cluster as critical when 5+ sessions", () => {
    const sessions = [
      makeSession("s1", 0, 1),
      makeSession("s2", 3, 1),
      makeSession("s3", 6, 1),
      makeSession("s4", 9, 1),
      makeSession("s5", 12, 1),
    ];
    const signals = detectAbandonment(sessions);
    const clusterSignals = signals.filter((signal) => signal.signalName === "restart-cluster");
    expect(clusterSignals[0].severity).toBe("critical");
  });

  it("detects high abandonment rate (many short sessions)", () => {
    const sessions = [
      makeSession("s1", 0, 1),
      makeSession("s2", 60, 0),
      makeSession("s3", 120, 2),
      makeSession("s4", 180, 0),
      makeSession("s5", 240, 1),
      makeSession("s6", 300, 10),
    ];
    const signals = detectAbandonment(sessions);
    const abandonmentSignals = signals.filter(
      (signal) => signal.signalName === "high-abandonment-rate",
    );
    expect(abandonmentSignals.length).toBe(1);
  });

  it("does not flag abandonment when most sessions are long", () => {
    const sessions = [
      makeSession("s1", 0, 10),
      makeSession("s2", 60, 15),
      makeSession("s3", 120, 20),
      makeSession("s4", 180, 1),
    ];
    const signals = detectAbandonment(sessions);
    const abandonmentSignals = signals.filter(
      (signal) => signal.signalName === "high-abandonment-rate",
    );
    expect(abandonmentSignals.length).toBe(0);
  });

  it("splits separate clusters correctly", () => {
    const sessions = [
      makeSession("s1", 0, 1),
      makeSession("s2", 5, 1),
      makeSession("s3", 10, 1),
      makeSession("s4", 120, 1),
      makeSession("s5", 125, 1),
      makeSession("s6", 130, 1),
    ];
    const signals = detectAbandonment(sessions);
    const clusterSignals = signals.filter((signal) => signal.signalName === "restart-cluster");
    expect(clusterSignals.length).toBe(2);
  });

  it("handles empty session list", () => {
    const signals = detectAbandonment([]);
    expect(signals.length).toBe(0);
  });

  it("handles single session", () => {
    const signals = detectAbandonment([makeSession("s1", 0, 5)]);
    expect(signals.length).toBe(0);
  });
});
