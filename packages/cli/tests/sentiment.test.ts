import * as path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { analyzeSessionSentiment, sentimentToSignals } from "../src/signals/sentiment.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

describe("analyzeSessionSentiment", () => {
  it("scores a happy session positively", async () => {
    const result = await analyzeSessionSentiment(fixture("happy-session.jsonl"), "happy-001");
    expect(result.averageScore).toBeGreaterThanOrEqual(0);
    expect(result.frustrationMessages.length).toBe(0);
    expect(result.interruptCount).toBe(0);
  });

  it("scores a frustrated session negatively", async () => {
    const result = await analyzeSessionSentiment(
      fixture("frustrated-session.jsonl"),
      "frustrated-001",
    );
    expect(result.averageScore).toBeLessThan(0);
    expect(result.worstScore).toBeLessThan(-2);
    expect(result.frustrationMessages.length).toBeGreaterThan(0);
  });

  it("detects custom negative tokens (revert, undo, shit)", async () => {
    const result = await analyzeSessionSentiment(
      fixture("frustrated-session.jsonl"),
      "frustrated-001",
    );
    const allNegativeWords = result.messageScores.flatMap((messageScore) => messageScore.negative);
    expect(allNegativeWords).toContain("wrong");
    expect(allNegativeWords).toContain("shit");
  });

  it("counts interrupts from transcript", async () => {
    const result = await analyzeSessionSentiment(
      fixture("frustrated-session.jsonl"),
      "frustrated-001",
    );
    expect(result.interruptCount).toBe(1);
  });

  it("returns empty frustration for meta-only session", async () => {
    const result = await analyzeSessionSentiment(fixture("meta-only-session.jsonl"), "meta-001");
    expect(result.frustrationMessages.length).toBe(0);
  });
});

describe("sentimentToSignals", () => {
  it("produces no signals for a happy session", async () => {
    const sentiment = await analyzeSessionSentiment(fixture("happy-session.jsonl"), "happy-001");
    const signals = sentimentToSignals(sentiment);
    const sentimentSignals = signals.filter((signal) => signal.signalName === "negative-sentiment");
    expect(sentimentSignals.length).toBe(0);
  });

  it("produces negative-sentiment signal for frustrated session", async () => {
    const sentiment = await analyzeSessionSentiment(
      fixture("frustrated-session.jsonl"),
      "frustrated-001",
    );
    const signals = sentimentToSignals(sentiment);
    const sentimentSignals = signals.filter((signal) => signal.signalName === "negative-sentiment");
    expect(sentimentSignals.length).toBe(1);
    expect(sentimentSignals[0].severity).toMatch(/critical|high|medium/);
  });

  it("produces user-interrupts signal", async () => {
    const sentiment = await analyzeSessionSentiment(
      fixture("frustrated-session.jsonl"),
      "frustrated-001",
    );
    const signals = sentimentToSignals(sentiment);
    const interruptSignals = signals.filter((signal) => signal.signalName === "user-interrupts");
    expect(interruptSignals.length).toBe(1);
  });

  it("produces extreme-frustration for very negative messages", async () => {
    const sentiment = await analyzeSessionSentiment(
      fixture("frustrated-session.jsonl"),
      "frustrated-001",
    );
    const signals = sentimentToSignals(sentiment);
    const extremeSignals = signals.filter((signal) => signal.signalName === "extreme-frustration");
    expect(extremeSignals.length).toBe(1);
    expect(extremeSignals[0].severity).toBe("critical");
  });
});
