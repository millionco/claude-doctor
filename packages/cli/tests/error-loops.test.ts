import * as path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { detectErrorLoops } from "../src/signals/error-loops.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

describe("detectErrorLoops", () => {
  it("detects consecutive is_error failures", async () => {
    const signals = await detectErrorLoops(fixture("error-loop-session.jsonl"), "error-001");
    expect(signals.length).toBeGreaterThanOrEqual(1);
    const firstLoop = signals[0];
    expect(firstLoop.signalName).toBe("error-loop");
    expect(firstLoop.details).toContain("Bash");
  });

  it("detects tool_use_error marker loops", async () => {
    const signals = await detectErrorLoops(fixture("error-loop-session.jsonl"), "error-001");
    const errorMarkerLoops = signals.filter((signal) =>
      signal.examples?.some((example) => example.includes("Stream closed")),
    );
    expect(errorMarkerLoops.length).toBe(1);
  });

  it("returns no signals for a clean session", async () => {
    const signals = await detectErrorLoops(fixture("happy-session.jsonl"), "happy-001");
    expect(signals.length).toBe(0);
  });

  it("rates 5+ consecutive failures as critical", async () => {
    const signals = await detectErrorLoops(fixture("error-loop-session.jsonl"), "error-001");
    const criticalSignals = signals.filter((signal) => signal.severity === "critical");
    expect(criticalSignals.length).toBeGreaterThanOrEqual(0);
  });

  it("includes error snippets in examples", async () => {
    const signals = await detectErrorLoops(fixture("error-loop-session.jsonl"), "error-001");
    for (const signal of signals) {
      expect(signal.examples).toBeDefined();
      expect(signal.examples!.length).toBeGreaterThan(0);
    }
  });
});
