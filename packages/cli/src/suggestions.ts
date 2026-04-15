import {
  SUGGESTION_EDIT_THRASHING_MIN,
  SUGGESTION_ERROR_LOOP_MIN,
  SUGGESTION_SENTIMENT_MIN,
  SUGGESTION_INTERRUPTS_MIN,
  SUGGESTION_RESTART_MIN,
  SUGGESTION_EXPLORATION_MIN,
  SUGGESTION_CORRECTION_MIN,
  SUGGESTION_KEEP_GOING_MIN,
  SUGGESTION_REPETITION_MIN,
  SUGGESTION_DRIFT_MIN,
  SUGGESTION_RAPID_MIN,
  SUGGESTION_TURN_RATIO_MIN,
} from "./constants.js";

const aggregateSignals = (
  projects: ProjectAnalysis[],
): SignalAggregation[] => {
  const aggregations = new Map<string, SignalAggregation>();

  for (const project of projects) {
    for (const signal of project.signals) {
      const existing = aggregations.get(signal.signalName);
      if (existing) {
        existing.count++;
        existing.totalScore += signal.score;
        existing.worstScore = Math.min(existing.worstScore, signal.score);
        if (!existing.affectedProjects.includes(project.projectName)) {
          existing.affectedProjects.push(project.projectName);
        }
      } else {
        aggregations.set(signal.signalName, {
          signalName: signal.signalName,
          count: 1,
          totalScore: signal.score,
          worstScore: signal.score,
          affectedProjects: [project.projectName],
        });
      }
    }
  }

  return [...aggregations.values()].sort(
    (left, right) => left.totalScore - right.totalScore,
  );
};

export const generateSuggestions = (
  projects: ProjectAnalysis[],
): string[] => {
  const suggestions: string[] = [];
  const aggregated = aggregateSignals(projects);

  for (const aggregation of aggregated) {
    switch (aggregation.signalName) {
      case "edit-thrashing": {
        if (aggregation.count >= SUGGESTION_EDIT_THRASHING_MIN) {
          suggestions.push(
            "Read the full file before editing. Plan all changes, then make ONE complete edit. If you've edited a file 3+ times, stop and re-read the user's requirements.",
          );
        }
        break;
      }

      case "error-loop": {
        if (aggregation.count >= SUGGESTION_ERROR_LOOP_MIN) {
          suggestions.push(
            "After 2 consecutive tool failures, stop and change your approach entirely. Explain what failed and try a different strategy.",
          );
        }
        break;
      }

      case "negative-sentiment":
      case "correction-heavy": {
        if (aggregation.count >= Math.min(SUGGESTION_SENTIMENT_MIN, SUGGESTION_CORRECTION_MIN)) {
          suggestions.push(
            "When the user corrects you, stop and re-read their message. Quote back what they asked for and confirm before proceeding.",
          );
        }
        break;
      }

      case "user-interrupts": {
        if (aggregation.count >= SUGGESTION_INTERRUPTS_MIN) {
          suggestions.push(
            "Break work into small, verifiable steps. Confirm your approach with the user before making large changes.",
          );
        }
        break;
      }

      case "restart-cluster": {
        if (aggregation.count >= SUGGESTION_RESTART_MIN) {
          suggestions.push(
            "When stuck, summarize what you've tried and ask the user for guidance instead of retrying the same approach.",
          );
        }
        break;
      }

      case "excessive-exploration": {
        if (aggregation.count >= SUGGESTION_EXPLORATION_MIN) {
          suggestions.push(
            "Act sooner. Don't read more than 3-5 files before making a change. Get a basic understanding, make the change, then iterate.",
          );
        }
        break;
      }

      case "keep-going-loop": {
        if (aggregation.count >= SUGGESTION_KEEP_GOING_MIN) {
          suggestions.push(
            "Complete the FULL task before stopping. If the user asked for multiple things, implement all of them before presenting results.",
          );
        }
        break;
      }

      case "repeated-instructions": {
        if (aggregation.count >= SUGGESTION_REPETITION_MIN) {
          suggestions.push(
            "Re-read the user's last message before responding. Follow through on every instruction completely.",
          );
        }
        break;
      }

      case "negative-drift": {
        if (aggregation.count >= SUGGESTION_DRIFT_MIN) {
          suggestions.push(
            "Every few turns, re-read the original request to make sure you haven't drifted from the goal.",
          );
        }
        break;
      }

      case "rapid-corrections": {
        if (aggregation.count >= SUGGESTION_RAPID_MIN) {
          suggestions.push(
            "Double-check your output before presenting it. Verify that your changes actually address what the user asked for.",
          );
        }
        break;
      }

      case "high-turn-ratio": {
        if (aggregation.count >= SUGGESTION_TURN_RATIO_MIN) {
          suggestions.push(
            "Work more autonomously. Make reasonable decisions without asking for confirmation on every step.",
          );
        }
        break;
      }
    }
  }

  return suggestions;
};

export const generateAgentsRules = (
  projects: ProjectAnalysis[],
  totalSessions: number,
): string => {
  const rules = generateSuggestions(projects);

  if (rules.length === 0) {
    return "";
  }

  const lines: string[] = [];

  lines.push("## Auto-generated rules");
  lines.push("");
  lines.push(
    `Based on analysis of ${totalSessions} sessions. Generated by claude-optimizer.`,
  );
  lines.push("");

  for (const rule of rules) {
    lines.push(`- ${rule}`);
  }

  lines.push("");

  return lines.join("\n");
};
