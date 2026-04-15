import { describe, it, expect } from "vite-plus/test";
import { generateSuggestions, generateAgentsRules } from "../src/suggestions.js";

const makeProject = (
  name: string,
  signals: SignalResult[],
): ProjectAnalysis => ({
  projectName: name,
  projectPath: `/test/${name}`,
  sessionCount: 10,
  signals,
  overallScore: signals.reduce((sum, signal) => sum + signal.score, 0),
});

const makeSignal = (
  signalName: string,
  score: number,
  severity: "critical" | "high" | "medium" | "low" = "high",
): SignalResult => ({
  signalName,
  severity,
  score,
  details: `Test signal: ${signalName}`,
});

describe("generateSuggestions", () => {
  it("generates rule for edit thrashing", () => {
    const projects = [
      makeProject("proj-a", [
        makeSignal("edit-thrashing", -20),
        makeSignal("edit-thrashing", -15),
      ]),
    ];
    const suggestions = generateSuggestions(projects);
    expect(suggestions.some((rule) => rule.includes("Read the full file before editing"))).toBe(true);
  });

  it("generates rule for error loops", () => {
    const projects = [
      makeProject("proj-a", [
        makeSignal("error-loop", -5),
        makeSignal("error-loop", -3),
        makeSignal("error-loop", -4),
      ]),
    ];
    const suggestions = generateSuggestions(projects);
    expect(suggestions.some((rule) => rule.includes("2 consecutive tool failures"))).toBe(true);
  });

  it("generates rule for user interrupts", () => {
    const projects = [
      makeProject("proj-a", [
        makeSignal("user-interrupts", -4),
        makeSignal("user-interrupts", -2),
      ]),
    ];
    const suggestions = generateSuggestions(projects);
    expect(suggestions.some((rule) => rule.includes("small, verifiable steps"))).toBe(true);
  });

  it("generates rule for excessive exploration", () => {
    const projects = [
      makeProject("proj-a", [
        makeSignal("excessive-exploration", -10),
        makeSignal("excessive-exploration", -8),
        makeSignal("excessive-exploration", -12),
      ]),
    ];
    const suggestions = generateSuggestions(projects);
    expect(suggestions.some((rule) => rule.includes("Act sooner"))).toBe(true);
  });

  it("returns empty array when no issues found", () => {
    const suggestions = generateSuggestions([makeProject("clean", [])]);
    expect(suggestions.length).toBe(0);
  });

  it("aggregates across multiple projects", () => {
    const projects = [
      makeProject("proj-a", [makeSignal("edit-thrashing", -10)]),
      makeProject("proj-b", [makeSignal("edit-thrashing", -20)]),
    ];
    const suggestions = generateSuggestions(projects);
    expect(suggestions.some((rule) => rule.includes("Read the full file"))).toBe(true);
  });
});

describe("generateAgentsRules", () => {
  it("outputs markdown with header", () => {
    const projects = [
      makeProject("proj-a", [
        makeSignal("edit-thrashing", -20),
        makeSignal("edit-thrashing", -15),
      ]),
    ];
    const rulesText = generateAgentsRules(projects, 100);
    expect(rulesText).toContain("## Auto-generated rules");
    expect(rulesText).toContain("100 sessions");
  });

  it("returns empty string when no rules", () => {
    const rulesText = generateAgentsRules([makeProject("clean", [])], 10);
    expect(rulesText).toBe("");
  });

  it("formats rules as markdown list items", () => {
    const projects = [
      makeProject("proj-a", [
        makeSignal("error-loop", -5),
        makeSignal("error-loop", -3),
        makeSignal("error-loop", -4),
      ]),
    ];
    const rulesText = generateAgentsRules(projects, 50);
    expect(rulesText).toContain("- After 2 consecutive tool failures");
  });
});
