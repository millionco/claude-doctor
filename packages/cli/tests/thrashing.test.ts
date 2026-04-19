import * as path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { detectThrashing } from "../src/signals/thrashing.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

describe("detectThrashing", () => {
  it("detects thrashing when a file is edited 5+ times", async () => {
    const signals = await detectThrashing(fixture("thrashing-session.jsonl"), "thrash-001");
    expect(signals.length).toBe(1);
    expect(signals[0].signalName).toBe("edit-thrashing");
    expect(signals[0].details).toContain("dashboard.tsx");
    expect(signals[0].details).toContain("6x");
  });

  it("returns no signals for a clean session", async () => {
    const signals = await detectThrashing(fixture("happy-session.jsonl"), "happy-001");
    expect(signals.length).toBe(0);
  });

  it("rates severity based on edit count", async () => {
    const signals = await detectThrashing(fixture("thrashing-session.jsonl"), "thrash-001");
    expect(signals[0].severity).toBe("medium");
  });

  it("does not flag files edited fewer than 5 times", async () => {
    const signals = await detectThrashing(fixture("thrashing-session.jsonl"), "thrash-001");
    for (const signal of signals) {
      expect(signal.details).not.toContain("sidebar.tsx");
    }
  });

  it("sets score to negative total thrashing edits", async () => {
    const signals = await detectThrashing(fixture("thrashing-session.jsonl"), "thrash-001");
    expect(signals[0].score).toBe(-6);
  });
});
