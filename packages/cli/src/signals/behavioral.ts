import { parseTranscriptFile, isUserEvent, isAssistantEvent } from "../parser.js";
import {
  CORRECTION_PATTERNS,
  KEEP_GOING_PATTERNS,
  MAX_USER_MESSAGE_LENGTH,
  META_MESSAGE_PATTERNS,
  REPETITION_SIMILARITY_THRESHOLD,
  REPETITION_LOOKAHEAD_WINDOW,
  MIN_REPETITIONS_TO_FLAG,
  REPETITION_CRITICAL_THRESHOLD,
  REPETITION_SCORE_MULTIPLIER,
  CORRECTION_RATE_THRESHOLD,
  CORRECTION_RATE_CRITICAL,
  MIN_CORRECTIONS_TO_FLAG,
  CORRECTION_SCORE_MULTIPLIER,
  KEEP_GOING_MIN_TO_FLAG,
  KEEP_GOING_HIGH_THRESHOLD,
  KEEP_GOING_SCORE_MULTIPLIER,
  DRIFT_MIN_MESSAGES,
  DRIFT_NEGATIVE_THRESHOLD,
  DRIFT_HIGH_THRESHOLD,
  DRIFT_LENGTH_WEIGHT,
  DRIFT_CORRECTION_WEIGHT,
  DRIFT_SCORE_MULTIPLIER,
  RAPID_FOLLOWUP_MS,
  RAPID_FOLLOWUP_MAX_MS,
  MIN_RAPID_FOLLOWUPS_TO_FLAG,
  RAPID_FOLLOWUP_HIGH_THRESHOLD,
  RAPID_FOLLOWUP_SCORE_MULTIPLIER,
  HIGH_TURN_RATIO_THRESHOLD,
  HIGH_TURN_RATIO_HIGH,
  MIN_USER_TURNS_FOR_RATIO,
  TURN_RATIO_SCORE_MULTIPLIER,
  SNIPPET_LENGTH,
} from "../constants.js";

const extractConversationTurns = (
  events: TranscriptEvent[],
): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];

  for (const event of events) {
    if (!event.timestamp) continue;
    const timestamp = new Date(event.timestamp).getTime();

    if (isUserEvent(event)) {
      const content = event.message?.content;
      if (event.isMeta) continue;

      const isToolResult = Array.isArray(content);
      const isInterrupt =
        typeof content === "string" &&
        /\[Request interrupted by user/.test(content);
      const textContent = typeof content === "string" ? content : "";
      const contentLength = isToolResult ? 0 : textContent.length;

      if (isToolResult && !isInterrupt) continue;

      turns.push({
        type: "user",
        timestamp,
        contentLength,
        isToolResult,
        isInterrupt,
        content: textContent,
      });
    }

    if (isAssistantEvent(event)) {
      const content = event.message?.content;
      const totalLength = Array.isArray(content)
        ? content.reduce((sum, block) => {
            if (block.type === "text") return sum + (block as TextBlock).text.length;
            return sum;
          }, 0)
        : 0;

      turns.push({
        type: "assistant",
        timestamp,
        contentLength: totalLength,
        isToolResult: false,
        isInterrupt: false,
      });
    }
  }

  return turns.sort((left, right) => left.timestamp - right.timestamp);
};

const isMetaContent = (content: string): boolean =>
  META_MESSAGE_PATTERNS.some((pattern) => pattern.test(content));

const extractUserTurns = (
  turns: ConversationTurn[],
): TimestampedUserMessage[] =>
  turns
    .filter(
      (turn) =>
        turn.type === "user" &&
        !turn.isToolResult &&
        !turn.isInterrupt &&
        turn.content &&
        turn.content.length > 0 &&
        turn.content.length < MAX_USER_MESSAGE_LENGTH &&
        !isMetaContent(turn.content),
    )
    .map((turn, index) => ({
      content: turn.content!,
      timestamp: turn.timestamp,
      index,
    }));

const wordSet = (text: string): Set<string> =>
  new Set(text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));

const jaccardSimilarity = (textA: string, textB: string): number => {
  const setA = wordSet(textA);
  const setB = wordSet(textB);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersectionSize = 0;
  for (const word of setA) {
    if (setB.has(word)) intersectionSize++;
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
};

const detectCorrectionPatterns = (
  userTurns: TimestampedUserMessage[],
): number => {
  let correctionCount = 0;
  for (const turn of userTurns) {
    const isCorrection = CORRECTION_PATTERNS.some((pattern) =>
      pattern.test(turn.content),
    );
    if (isCorrection) correctionCount++;
  }
  return correctionCount;
};

const detectKeepGoingLoops = (
  userTurns: TimestampedUserMessage[],
): number => {
  let keepGoingCount = 0;
  for (const turn of userTurns) {
    const isKeepGoing = KEEP_GOING_PATTERNS.some((pattern) =>
      pattern.test(turn.content.trim()),
    );
    if (isKeepGoing) keepGoingCount++;
  }
  return keepGoingCount;
};

const detectRepetition = (
  userTurns: TimestampedUserMessage[],
): Array<{ messageA: string; messageB: string; similarity: number }> => {
  const repeats: Array<{
    messageA: string;
    messageB: string;
    similarity: number;
  }> = [];

  for (
    let outerIndex = 0;
    outerIndex < userTurns.length;
    outerIndex++
  ) {
    for (
      let innerIndex = outerIndex + 1;
      innerIndex < Math.min(outerIndex + REPETITION_LOOKAHEAD_WINDOW, userTurns.length);
      innerIndex++
    ) {
      const similarity = jaccardSimilarity(
        userTurns[outerIndex].content,
        userTurns[innerIndex].content,
      );
      if (similarity >= REPETITION_SIMILARITY_THRESHOLD) {
        repeats.push({
          messageA: userTurns[outerIndex].content,
          messageB: userTurns[innerIndex].content,
          similarity,
        });
      }
    }
  }

  return repeats;
};

const detectSentimentDrift = (
  userTurns: TimestampedUserMessage[],
): { driftScore: number; isNegativeDrift: boolean } => {
  if (userTurns.length < DRIFT_MIN_MESSAGES)
    return { driftScore: 0, isNegativeDrift: false };

  const midpoint = Math.floor(userTurns.length / 2);
  const firstHalf = userTurns.slice(0, midpoint);
  const secondHalf = userTurns.slice(midpoint);

  const avgLength = (turns: TimestampedUserMessage[]) =>
    turns.reduce((sum, turn) => sum + turn.content.length, 0) / turns.length;

  const firstHalfAvgLength = avgLength(firstHalf);
  const secondHalfAvgLength = avgLength(secondHalf);

  const correctionRate = (turns: TimestampedUserMessage[]) => {
    const corrections = turns.filter((turn) =>
      CORRECTION_PATTERNS.some((pattern) => pattern.test(turn.content)),
    );
    return corrections.length / turns.length;
  };

  const firstCorrectionRate = correctionRate(firstHalf);
  const secondCorrectionRate = correctionRate(secondHalf);

  const lengthShrinkage =
    firstHalfAvgLength > 0
      ? (firstHalfAvgLength - secondHalfAvgLength) / firstHalfAvgLength
      : 0;

  const correctionIncrease = secondCorrectionRate - firstCorrectionRate;

  const driftScore = lengthShrinkage * DRIFT_LENGTH_WEIGHT + correctionIncrease * DRIFT_CORRECTION_WEIGHT;

  return {
    driftScore,
    isNegativeDrift: driftScore > DRIFT_NEGATIVE_THRESHOLD,
  };
};

const detectFollowUpVelocity = (
  turns: ConversationTurn[],
): { fastFollowUps: number; averageResponseMs: number } => {
  let fastFollowUps = 0;
  let totalResponseMs = 0;
  let responseCount = 0;

  for (let turnIndex = 1; turnIndex < turns.length; turnIndex++) {
    const currentTurn = turns[turnIndex];
    const previousTurn = turns[turnIndex - 1];

    if (
      currentTurn.type === "user" &&
      previousTurn.type === "assistant" &&
      !currentTurn.isToolResult &&
      currentTurn.content &&
      !isMetaContent(currentTurn.content)
    ) {
      const responseTimeMs = currentTurn.timestamp - previousTurn.timestamp;

      if (responseTimeMs < RAPID_FOLLOWUP_MS && responseTimeMs > 0) {
        fastFollowUps++;
      }

      if (responseTimeMs > 0 && responseTimeMs < RAPID_FOLLOWUP_MAX_MS) {
        totalResponseMs += responseTimeMs;
        responseCount++;
      }
    }
  }

  return {
    fastFollowUps,
    averageResponseMs:
      responseCount > 0 ? totalResponseMs / responseCount : 0,
  };
};

export const detectBehavioralSignals = async (
  filePath: string,
  sessionId: string,
): Promise<SignalResult[]> => {
  const events = await parseTranscriptFile(filePath);
  const turns = extractConversationTurns(events);
  const userTurns = extractUserTurns(turns);
  const signals: SignalResult[] = [];

  if (userTurns.length === 0) return signals;

  const correctionCount = detectCorrectionPatterns(userTurns);
  const correctionRate = correctionCount / userTurns.length;

  if (correctionCount >= MIN_CORRECTIONS_TO_FLAG && correctionRate > CORRECTION_RATE_THRESHOLD) {
    signals.push({
      signalName: "correction-heavy",
      severity: correctionRate > CORRECTION_RATE_CRITICAL ? "critical" : "high",
      score: -Math.round(correctionCount * CORRECTION_SCORE_MULTIPLIER),
      details: `${correctionCount}/${userTurns.length} user messages (${Math.round(correctionRate * 100)}%) were corrections. The agent repeatedly misunderstands or produces wrong output.`,
      sessionId,
      examples: userTurns
        .filter((turn) =>
          CORRECTION_PATTERNS.some((pattern) => pattern.test(turn.content)),
        )
        .slice(0, 5)
        .map((turn) => turn.content.slice(0, SNIPPET_LENGTH)),
    });
  }

  const keepGoingCount = detectKeepGoingLoops(userTurns);

  if (keepGoingCount >= KEEP_GOING_MIN_TO_FLAG) {
    signals.push({
      signalName: "keep-going-loop",
      severity: keepGoingCount >= KEEP_GOING_HIGH_THRESHOLD ? "high" : "medium",
      score: -keepGoingCount * KEEP_GOING_SCORE_MULTIPLIER,
      details: `User said "keep going" or equivalent ${keepGoingCount} time(s). The agent stops prematurely or produces incomplete work.`,
      sessionId,
      examples: userTurns
        .filter((turn) =>
          KEEP_GOING_PATTERNS.some((pattern) =>
            pattern.test(turn.content.trim()),
          ),
        )
        .slice(0, 3)
        .map((turn) => turn.content.slice(0, SNIPPET_LENGTH)),
    });
  }

  const repetitions = detectRepetition(userTurns);

  if (repetitions.length >= MIN_REPETITIONS_TO_FLAG) {
    signals.push({
      signalName: "repeated-instructions",
      severity: repetitions.length >= REPETITION_CRITICAL_THRESHOLD ? "critical" : "high",
      score: -repetitions.length * REPETITION_SCORE_MULTIPLIER,
      details: `User repeated similar instructions ${repetitions.length} time(s). The agent failed to act on the instruction correctly.`,
      sessionId,
      examples: repetitions
        .slice(0, 3)
        .map(
          (repetition) =>
            `"${repetition.messageA.slice(0, 80)}" ~ "${repetition.messageB.slice(0, 80)}" (${Math.round(repetition.similarity * 100)}% similar)`,
        ),
    });
  }

  const { driftScore, isNegativeDrift } = detectSentimentDrift(userTurns);

  if (isNegativeDrift) {
    signals.push({
      signalName: "negative-drift",
      severity: driftScore > DRIFT_HIGH_THRESHOLD ? "high" : "medium",
      score: -Math.round(driftScore * DRIFT_SCORE_MULTIPLIER),
      details: `User messages became shorter and more corrective over the session (drift: ${driftScore.toFixed(1)}). Indicates growing frustration.`,
      sessionId,
    });
  }

  const { fastFollowUps } = detectFollowUpVelocity(turns);

  if (fastFollowUps >= MIN_RAPID_FOLLOWUPS_TO_FLAG) {
    signals.push({
      signalName: "rapid-corrections",
      severity: fastFollowUps >= RAPID_FOLLOWUP_HIGH_THRESHOLD ? "high" : "medium",
      score: -fastFollowUps * RAPID_FOLLOWUP_SCORE_MULTIPLIER,
      details: `${fastFollowUps} user messages sent within 10 seconds of the agent responding. Rapid follow-ups indicate the agent's output was immediately wrong.`,
      sessionId,
    });
  }

  const userTurnCount = turns.filter(
    (turn) => turn.type === "user" && !turn.isToolResult,
  ).length;
  const assistantTurnCount = turns.filter(
    (turn) => turn.type === "assistant",
  ).length;

  if (assistantTurnCount > 0 && userTurnCount > 0) {
    const turnRatio = userTurnCount / assistantTurnCount;
    if (turnRatio > HIGH_TURN_RATIO_THRESHOLD && userTurnCount >= MIN_USER_TURNS_FOR_RATIO) {
      signals.push({
        signalName: "high-turn-ratio",
        severity: turnRatio > HIGH_TURN_RATIO_HIGH ? "high" : "medium",
        score: -Math.round(turnRatio * TURN_RATIO_SCORE_MULTIPLIER),
        details: `Turn ratio: ${turnRatio.toFixed(1)} user messages per assistant response. High ratio means the user keeps redirecting or correcting the agent.`,
        sessionId,
      });
    }
  }

  return signals;
};
