import * as path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { detectToolInefficiency } from "../src/signals/tool-efficiency.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

describe("detectToolInefficiency", () => {
  it("detects excessive read-to-edit ratio", async () => {
    const signals = await detectToolInefficiency(
      fixture("exploration-heavy-session.jsonl"),
      "explore-001",
    );
    const explorationSignals = signals.filter(
      (signal) => signal.signalName === "excessive-exploration",
    );
    expect(explorationSignals.length).toBe(1);
    expect(explorationSignals[0].details).toContain("Read-to-edit ratio");
  });

  it("returns no signals for a balanced session", async () => {
    const signals = await detectToolInefficiency(fixture("happy-session.jsonl"), "happy-001");
    expect(signals.length).toBe(0);
  });

  it("includes read and edit counts in details", async () => {
    const signals = await detectToolInefficiency(
      fixture("exploration-heavy-session.jsonl"),
      "explore-001",
    );
    expect(signals[0].details).toMatch(/\d+ reads/);
    expect(signals[0].details).toMatch(/\d+ edits/);
  });
});
