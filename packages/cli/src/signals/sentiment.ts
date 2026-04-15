import Sentiment from "sentiment";
import {
  SENTINEL_CUSTOM_TOKENS,
  INTERRUPT_PATTERN,
  SENTIMENT_FRUSTRATION_THRESHOLD,
  SENTIMENT_NEGATIVE_THRESHOLD,
  SENTIMENT_CRITICAL_THRESHOLD,
  SENTIMENT_HIGH_THRESHOLD,
  SENTIMENT_EXTREME_THRESHOLD,
  INTERRUPT_SCORE_MULTIPLIER,
  INTERRUPT_CRITICAL_THRESHOLD,
} from "../constants.js";
import { parseTranscriptFile, extractUserMessages, isUserEvent } from "../parser.js";

const analyzer = new Sentiment();

const CUSTOM_SCORING: Record<string, number> = {};
for (const [phrase, score] of Object.entries(SENTINEL_CUSTOM_TOKENS)) {
  for (const word of phrase.split(" ")) {
    if (CUSTOM_SCORING[word] === undefined || score < CUSTOM_SCORING[word]) {
      CUSTOM_SCORING[word] = score;
    }
  }
}

const scoreMessage = (message: string): SentimentScore => {
  const result = analyzer.analyze(message, { extras: CUSTOM_SCORING });
  return {
    score: result.score,
    comparative: result.comparative,
    positive: result.positive,
    negative: result.negative,
    message,
  };
};

export const analyzeSessionSentiment = async (
  filePath: string,
  sessionId: string,
): Promise<SessionSentiment> => {
  const events = await parseTranscriptFile(filePath);
  const userMessages = extractUserMessages(events);

  const messageScores = userMessages.map(scoreMessage);
  const interruptCount = events.filter((event) => {
    if (!isUserEvent(event)) return false;
    const content = event.message?.content;
    return typeof content === "string" && INTERRUPT_PATTERN.test(content);
  }).length;

  const scores = messageScores.map((messageScore) => messageScore.score);
  const averageScore =
    scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  const worstScore = scores.length > 0 ? Math.min(...scores) : 0;

  const frustrationMessages = messageScores
    .filter((messageScore) => messageScore.score < SENTIMENT_FRUSTRATION_THRESHOLD)
    .map((messageScore) => messageScore.message);

  return {
    sessionId,
    averageScore,
    worstScore,
    messageScores,
    interruptCount,
    frustrationMessages,
  };
};

export const sentimentToSignals = (
  sessionSentiment: SessionSentiment,
): SignalResult[] => {
  const signals: SignalResult[] = [];

  if (sessionSentiment.averageScore < SENTIMENT_NEGATIVE_THRESHOLD) {
    signals.push({
      signalName: "negative-sentiment",
      severity:
        sessionSentiment.averageScore < SENTIMENT_CRITICAL_THRESHOLD
          ? "critical"
          : sessionSentiment.averageScore < SENTIMENT_HIGH_THRESHOLD
            ? "high"
            : "medium",
      score: sessionSentiment.averageScore,
      details: `Average sentiment score: ${sessionSentiment.averageScore.toFixed(2)} across ${sessionSentiment.messageScores.length} messages`,
      sessionId: sessionSentiment.sessionId,
      examples: sessionSentiment.frustrationMessages.slice(0, 5),
    });
  }

  if (sessionSentiment.interruptCount > 0) {
    signals.push({
      signalName: "user-interrupts",
      severity: sessionSentiment.interruptCount >= INTERRUPT_CRITICAL_THRESHOLD ? "critical" : "high",
      score: -sessionSentiment.interruptCount * INTERRUPT_SCORE_MULTIPLIER,
      details: `User interrupted the agent ${sessionSentiment.interruptCount} time(s)`,
      sessionId: sessionSentiment.sessionId,
    });
  }

  if (sessionSentiment.worstScore < SENTIMENT_EXTREME_THRESHOLD) {
    signals.push({
      signalName: "extreme-frustration",
      severity: "critical",
      score: sessionSentiment.worstScore,
      details: `Worst single message score: ${sessionSentiment.worstScore}`,
      sessionId: sessionSentiment.sessionId,
      examples: sessionSentiment.frustrationMessages.slice(0, 3),
    });
  }

  return signals;
};
