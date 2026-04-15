interface ContentBlock {
  type: string;
}

interface TextBlock extends ContentBlock {
  type: "text";
  text: string;
}

interface ThinkingBlock extends ContentBlock {
  type: "thinking";
  thinking: string;
}

interface ToolUseBlock extends ContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock extends ContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

interface UserMessage {
  role: "user";
  content: string | Array<ToolResultBlock | ContentBlock>;
}

interface AssistantMessage {
  role: "assistant";
  model?: string;
  id?: string;
  type?: "message";
  content: Array<TextBlock | ThinkingBlock | ToolUseBlock>;
  stop_reason?: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface BaseEvent {
  type: string;
  sessionId: string;
  timestamp: string;
  uuid?: string;
  parentUuid?: string | null;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  entrypoint?: string;
  userType?: string;
  isSidechain?: boolean;
}

interface UserEvent extends BaseEvent {
  type: "user";
  message: UserMessage;
  promptId?: string;
  isMeta?: boolean;
}

interface AssistantEvent extends BaseEvent {
  type: "assistant";
  message: AssistantMessage;
  requestId?: string;
}

interface QueueOperationEvent extends BaseEvent {
  type: "queue-operation";
  operation: "enqueue" | "dequeue";
  content?: string;
}

type TranscriptEvent =
  | UserEvent
  | AssistantEvent
  | QueueOperationEvent
  | BaseEvent;

interface SessionMetadata {
  sessionId: string;
  projectPath: string;
  projectName: string;
  filePath: string;
  startTime: Date;
  endTime: Date;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  interruptCount: number;
}

interface ProjectMetadata {
  projectPath: string;
  projectName: string;
  sessions: SessionMetadata[];
  totalSessions: number;
}

interface SignalResult {
  signalName: string;
  severity: "critical" | "high" | "medium" | "low";
  score: number;
  details: string;
  sessionId?: string;
  examples?: string[];
}

interface AnalysisReport {
  generatedAt: Date;
  totalSessions: number;
  totalProjects: number;
  projects: ProjectAnalysis[];
  topSignals: SignalResult[];
  suggestions: string[];
}

interface ProjectAnalysis {
  projectName: string;
  projectPath: string;
  sessionCount: number;
  signals: SignalResult[];
  overallScore: number;
}

interface SentimentScore {
  score: number;
  comparative: number;
  positive: string[];
  negative: string[];
  message: string;
}

interface SessionSentiment {
  sessionId: string;
  averageScore: number;
  worstScore: number;
  messageScores: SentimentScore[];
  interruptCount: number;
  frustrationMessages: string[];
}

interface ToolUseEntry {
  name: string;
  input: Record<string, unknown>;
  id: string;
}

interface SessionTimeRange {
  start: Date;
  end: Date;
}

interface SignalAggregation {
  signalName: string;
  count: number;
  totalScore: number;
  worstScore: number;
  affectedProjects: string[];
}

interface ProjectProfile {
  projectPath: string;
  sessionCount: number;
  overallScore: number;
  signalFrequency: Record<string, number>;
  topIssues: string[];
  suggestions: string[];
}

interface SavedModel {
  version: number;
  savedAt: string;
  totalSessions: number;
  totalProjects: number;
  signalBaselines: Record<string, number>;
  projects: ProjectProfile[];
  globalSuggestions: string[];
}

interface CheckResult {
  sessionId: string;
  isHealthy: boolean;
  activeSignals: SignalResult[];
  guidance: string[];
}

interface AbandonmentCluster {
  sessionIds: string[];
  windowMs: number;
  startTime: Date;
}

interface FileEditCount {
  filePath: string;
  editCount: number;
  toolNames: string[];
}

interface ErrorSequence {
  toolName: string;
  consecutiveFailures: number;
  errorSnippets: string[];
}

interface TimestampedUserMessage {
  content: string;
  timestamp: number;
  index: number;
}

interface ConversationTurn {
  type: "user" | "assistant";
  timestamp: number;
  contentLength: number;
  isToolResult: boolean;
  isInterrupt: boolean;
  content?: string;
}

interface TurnHealth {
  index: number;
  type: "user" | "assistant" | "tool-error" | "interrupt";
  health: "green" | "yellow" | "red";
  reason?: string;
  snippet?: string;
}

interface SessionTimeline {
  turns: TurnHealth[];
  healthPercentage: number;
  summary: string;
}
