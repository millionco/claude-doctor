export const CLAUDE_PROJECTS_DIR = ".claude/projects";

export const ABANDONMENT_WINDOW_MS = 30 * 60 * 1000;
export const SHORT_SESSION_THRESHOLD = 3;
export const SHORT_SESSION_RATIO_THRESHOLD = 0.3;
export const SHORT_SESSION_RATIO_CRITICAL = 0.5;
export const MIN_SHORT_SESSIONS_TO_FLAG = 3;
export const RESTART_CLUSTER_CRITICAL_THRESHOLD = 5;

export const THRASHING_EDIT_THRESHOLD = 5;
export const THRASHING_SEVERITY_CRITICAL = 20;
export const THRASHING_SEVERITY_HIGH = 10;

export const ERROR_LOOP_THRESHOLD = 3;
export const ERROR_LOOP_CRITICAL_THRESHOLD = 5;
export const ERROR_SNIPPET_MAX_LENGTH = 200;

export const READ_TO_EDIT_RATIO_THRESHOLD = 10;
export const READ_TO_EDIT_RATIO_HIGH = 20;
export const READ_ONLY_SESSION_THRESHOLD = 20;
export const READ_ONLY_SESSION_SCORE = -5;

export const MAX_USER_MESSAGE_LENGTH = 2000;

export const SENTIMENT_FRUSTRATION_THRESHOLD = -2;
export const SENTIMENT_NEGATIVE_THRESHOLD = -1;
export const SENTIMENT_CRITICAL_THRESHOLD = -3;
export const SENTIMENT_HIGH_THRESHOLD = -2;
export const SENTIMENT_EXTREME_THRESHOLD = -5;
export const INTERRUPT_SCORE_MULTIPLIER = 2;
export const INTERRUPT_CRITICAL_THRESHOLD = 3;

export const CORRECTION_RATE_THRESHOLD = 0.2;
export const CORRECTION_RATE_CRITICAL = 0.4;
export const MIN_CORRECTIONS_TO_FLAG = 2;
export const CORRECTION_SCORE_MULTIPLIER = 3;

export const KEEP_GOING_MIN_TO_FLAG = 2;
export const KEEP_GOING_HIGH_THRESHOLD = 4;
export const KEEP_GOING_SCORE_MULTIPLIER = 2;

export const REPETITION_SIMILARITY_THRESHOLD = 0.6;
export const REPETITION_LOOKAHEAD_WINDOW = 5;
export const MIN_REPETITIONS_TO_FLAG = 2;
export const REPETITION_CRITICAL_THRESHOLD = 4;
export const REPETITION_SCORE_MULTIPLIER = 3;

export const DRIFT_MIN_MESSAGES = 4;
export const DRIFT_NEGATIVE_THRESHOLD = 2;
export const DRIFT_HIGH_THRESHOLD = 5;
export const DRIFT_LENGTH_WEIGHT = 5;
export const DRIFT_CORRECTION_WEIGHT = 10;
export const DRIFT_SCORE_MULTIPLIER = 2;

export const RAPID_FOLLOWUP_MS = 10_000;
export const RAPID_FOLLOWUP_MAX_MS = 3_600_000;
export const MIN_RAPID_FOLLOWUPS_TO_FLAG = 3;
export const RAPID_FOLLOWUP_HIGH_THRESHOLD = 5;
export const RAPID_FOLLOWUP_SCORE_MULTIPLIER = 2;

export const HIGH_TURN_RATIO_THRESHOLD = 1.5;
export const HIGH_TURN_RATIO_HIGH = 2.5;
export const MIN_USER_TURNS_FOR_RATIO = 5;
export const TURN_RATIO_SCORE_MULTIPLIER = 2;

export const SUGGESTION_EDIT_THRASHING_MIN = 2;
export const SUGGESTION_ERROR_LOOP_MIN = 3;
export const SUGGESTION_SENTIMENT_MIN = 3;
export const SUGGESTION_INTERRUPTS_MIN = 2;
export const SUGGESTION_RESTART_MIN = 2;
export const SUGGESTION_EXPLORATION_MIN = 3;
export const SUGGESTION_READ_ONLY_MIN = 3;
export const SUGGESTION_CORRECTION_MIN = 2;
export const SUGGESTION_KEEP_GOING_MIN = 2;
export const SUGGESTION_REPETITION_MIN = 2;
export const SUGGESTION_DRIFT_MIN = 2;
export const SUGGESTION_RAPID_MIN = 2;
export const SUGGESTION_TURN_RATIO_MIN = 2;

export const SEVERITY_WEIGHT_CRITICAL = 4;
export const SEVERITY_WEIGHT_HIGH = 3;
export const SEVERITY_WEIGHT_MEDIUM = 2;
export const SEVERITY_WEIGHT_LOW = 1;

export const TOP_SIGNALS_LIMIT = 20;
export const REPORT_PROJECT_LIMIT = 10;
export const REPORT_SIGNAL_DISPLAY_LIMIT = 15;
export const EXAMPLE_TRUNCATE_LENGTH = 120;
export const SNIPPET_LENGTH = 60;
export const MODEL_TOP_ISSUES_LIMIT = 5;
export const PROBLEM_TURNS_DISPLAY_LIMIT = 5;
export const SIGNAL_DETAIL_DISPLAY_LENGTH = 80;

export const HEALTH_GOOD_THRESHOLD = 80;
export const HEALTH_FAIR_THRESHOLD = 50;
export const HEALTH_BAR_WIDTH = 20;
export const TIMELINE_MAX_WIDTH = 60;

export const VIZ_SENTIMENT_RED_THRESHOLD = -0.5;
export const VIZ_SENTIMENT_YELLOW_THRESHOLD = -0.1;

export const SAVED_MODEL_VERSION = 1;

export const SENTINEL_CUSTOM_TOKENS: Record<string, number> = {
  undo: -3,
  revert: -3,
  wrong: -3,
  incorrect: -3,
  rollback: -3,
  "start over": -4,
  "try again": -2,
  "not what i": -4,
  "that's not": -3,
  "thats not": -3,
  "already told": -4,
  "i said": -3,
  "just do": -2,
  shit: -3,
  fuck: -4,
  bitch: -4,
  damn: -2,
  broken: -2,
  "doesn't work": -3,
  "doesnt work": -3,
  "not working": -3,
  "still broken": -4,
  "keep going": -1,
};

export const INTERRUPT_PATTERN = /\[Request interrupted by user/;

export const META_MESSAGE_PATTERNS = [
  /^<local-command/,
  /^<command-name>/,
  /^<environment>/,
  /^<local-command-stdout>/,
  /^<local-command-caveat>/,
  /^<task-notification/,
  /^<skill/,
  /^\/\*\*/,
  /^```/,
];

export const EDIT_TOOL_NAMES = [
  "Write",
  "Edit",
  "MultiEdit",
  "Replace",
  "write_to_file",
  "edit_file",
  "str_replace_editor",
  "insert_content",
];

export const READ_TOOL_NAMES = [
  "Read",
  "View",
  "read_file",
  "Grep",
  "Glob",
  "Search",
  "find_file",
  "search_files",
  "list_files",
  "LS",
];

export const CORRECTION_PATTERNS = [
  /^no[,.\s!]/i,
  /^nope/i,
  /^wrong/i,
  /^that'?s not/i,
  /^not what i/i,
  /^i (said|meant|asked|wanted)/i,
  /^actually[,\s]/i,
  /^wait[,\s]/i,
  /^stop/i,
  /^instead[,\s]/i,
  /^don'?t do that/i,
  /^why did you/i,
];

export const KEEP_GOING_PATTERNS = [
  /^keep going/i,
  /^continue/i,
  /^keep at it/i,
  /^more$/i,
  /^finish/i,
  /^go on/i,
  /^don'?t stop/i,
  /^you'?re not done/i,
  /^not done/i,
  /^keep iterating/i,
];
