import * as path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { detectBehavioralSignals } from "../src/signals/behavioral.js";

const fixture = (name: string) =>
  path.join(import.meta.dirname, "fixtures", name);

describe("detectBehavioralSignals", () => {
  describe("correction detection", () => {
    it("detects high correction rate in correction-heavy session", async () => {
      const signals = await detectBehavioralSignals(
        fixture("correction-heavy-session.jsonl"),
        "correction-001",
      );
      const correctionSignals = signals.filter(
        (signal) => signal.signalName === "correction-heavy",
      );
      expect(correctionSignals.length).toBe(1);
      expect(correctionSignals[0].details).toContain("corrections");
    });

    it("includes correction examples in output", async () => {
      const signals = await detectBehavioralSignals(
        fixture("correction-heavy-session.jsonl"),
        "correction-001",
      );
      const correctionSignals = signals.filter(
        (signal) => signal.signalName === "correction-heavy",
      );
      expect(correctionSignals[0].examples).toBeDefined();
      expect(correctionSignals[0].examples!.length).toBeGreaterThan(0);
    });

    it("does not flag corrections in a happy session", async () => {
      const signals = await detectBehavioralSignals(
        fixture("happy-session.jsonl"),
        "happy-001",
      );
      const correctionSignals = signals.filter(
        (signal) => signal.signalName === "correction-heavy",
      );
      expect(correctionSignals.length).toBe(0);
    });
  });

  describe("keep-going loop detection", () => {
    it("detects keep-going patterns", async () => {
      const signals = await detectBehavioralSignals(
        fixture("keep-going-session.jsonl"),
        "keep-going-001",
      );
      const keepGoingSignals = signals.filter(
        (signal) => signal.signalName === "keep-going-loop",
      );
      expect(keepGoingSignals.length).toBe(1);
      expect(keepGoingSignals[0].details).toContain("keep going");
    });

    it("does not flag sessions without keep-going", async () => {
      const signals = await detectBehavioralSignals(
        fixture("happy-session.jsonl"),
        "happy-001",
      );
      const keepGoingSignals = signals.filter(
        (signal) => signal.signalName === "keep-going-loop",
      );
      expect(keepGoingSignals.length).toBe(0);
    });
  });

  describe("sentiment drift detection", () => {
    it("detects negative drift in degrading session", async () => {
      const signals = await detectBehavioralSignals(
        fixture("drift-session.jsonl"),
        "drift-001",
      );
      const driftSignals = signals.filter(
        (signal) => signal.signalName === "negative-drift",
      );
      expect(driftSignals.length).toBe(1);
      expect(driftSignals[0].details).toContain("shorter");
    });

    it("does not detect drift in happy session", async () => {
      const signals = await detectBehavioralSignals(
        fixture("happy-session.jsonl"),
        "happy-001",
      );
      const driftSignals = signals.filter(
        (signal) => signal.signalName === "negative-drift",
      );
      expect(driftSignals.length).toBe(0);
    });
  });

  describe("rapid correction detection", () => {
    it("detects rapid follow-ups within 10 seconds", async () => {
      const signals = await detectBehavioralSignals(
        fixture("rapid-correction-session.jsonl"),
        "rapid-001",
      );
      const rapidSignals = signals.filter(
        (signal) => signal.signalName === "rapid-corrections",
      );
      expect(rapidSignals.length).toBe(1);
      expect(rapidSignals[0].details).toContain("within 10 seconds");
    });

    it("does not flag sessions with normal response timing", async () => {
      const signals = await detectBehavioralSignals(
        fixture("drift-session.jsonl"),
        "drift-001",
      );
      const rapidSignals = signals.filter(
        (signal) => signal.signalName === "rapid-corrections",
      );
      expect(rapidSignals.length).toBe(0);
    });
  });

  describe("happy path", () => {
    it("returns no behavioral signals for a clean session", async () => {
      const signals = await detectBehavioralSignals(
        fixture("happy-session.jsonl"),
        "happy-001",
      );
      expect(signals.length).toBe(0);
    });

    it("returns empty for meta-only session", async () => {
      const signals = await detectBehavioralSignals(
        fixture("meta-only-session.jsonl"),
        "meta-001",
      );
      expect(signals.length).toBe(0);
    });
  });

  describe("combined signals", () => {
    it("can produce multiple signal types from one session", async () => {
      const signals = await detectBehavioralSignals(
        fixture("drift-session.jsonl"),
        "drift-001",
      );
      const signalNames = new Set(
        signals.map((signal) => signal.signalName),
      );
      expect(signalNames.size).toBeGreaterThanOrEqual(2);
    });

    it("frustrated session triggers behavioral signals too", async () => {
      const signals = await detectBehavioralSignals(
        fixture("frustrated-session.jsonl"),
        "frustrated-001",
      );
      expect(signals.length).toBeGreaterThan(0);
    });
  });
});
