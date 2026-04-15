# Codebase Summary: claude-doctor

**Version:** 0.0.3  
**License:** MIT  
**Author:** Aiden Bai (aiden@million.dev)  
**Repository:** https://github.com/aidenybai/claude-doctor

## Overview

`claude-doctor` is a diagnostic tool that analyzes Claude Code (Cursor IDE) session transcripts to identify behavioral anti-patterns, quality signals, and sentiment drift. It helps developers understand how their AI coding sessions are performing and generates actionable rules for improving Claude agent behavior through `CLAUDE.md` or `AGENTS.md` configuration files.

## Architecture

### Project Structure

```
claude-doctor/
├── packages/
│   └── cli/                    # Main CLI package
│       ├── src/
│       │   ├── cli.ts          # CLI entrypoint & command handling
│       │   ├── index.ts        # Public API exports
│       │   ├── types.d.ts      # TypeScript type definitions
│       │   ├── constants.ts    # Configuration constants & thresholds
│       │   ├── parser.ts       # JSONL transcript parsing
│       │   ├── indexer.ts      # Session discovery & indexing
│       │   ├── reporter.ts     # Report generation & formatting
│       │   ├── suggestions.ts  # Rule generation from signals
│       │   ├── model.ts        # Model persistence & session checking
│       │   ├── viz.ts          # Terminal visualization & rendering
│       │   └── signals/        # Signal detection modules
│       │       ├── sentiment.ts        # Sentiment analysis (AFINN-165)
│       │       ├── thrashing.ts        # Edit thrashing detection
│       │       ├── error-loops.ts      # Error loop detection
│       │       ├── tool-efficiency.ts  # Tool usage efficiency
│       │       ├── behavioral.ts       # Behavioral pattern detection
│       │       └── abandonment.ts      # Session abandonment detection
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
├── package.json                # Root monorepo config
├── pnpm-workspace.yaml         # pnpm workspace definition
├── turbo.json                  # Turborepo configuration
├── AGENTS.md                   # Agent development rules
└── README.md                   # User-facing documentation
```

### Monorepo Setup

- **Build System:** Turborepo for orchestration, vite-plus for bundling
- **Package Manager:** pnpm v10.29.1
- **Language:** TypeScript with ES modules
- **Node Version:** >=18

## Core Functionality

### 1. **Transcript Parsing** (`parser.ts`)

Reads JSONL transcript files from `~/.claude/projects/` containing:
- User messages and assistant responses
- Tool use events (read, write, search operations)
- Tool result events (successes and errors)
- Metadata (timestamps, session IDs, project paths)

Key functions:
- `parseTranscriptFile()` - Parses JSONL into structured events
- `extractUserMessages()` - Filters user messages (excludes meta-messages)
- `extractToolUses()` - Extracts all tool invocations
- `extractToolErrors()` - Counts tool failures
- `countInterrupts()` - Detects user interruptions

### 2. **Signal Detection**

The tool detects multiple categories of issues:

#### **Structural Signals**
- **edit-thrashing** (`thrashing.ts`): Same file edited 5+ times in one session
- **error-loop** (`error-loops.ts`): 3+ consecutive tool failures without approach change
- **excessive-exploration** (`tool-efficiency.ts`): Read-to-edit ratio above 10:1
- **restart-cluster** (`abandonment.ts`): Multiple sessions started within 30 minutes
- **high-abandonment-rate** (`abandonment.ts`): Most sessions have <3 user messages

#### **Behavioral Signals** (`behavioral.ts`)
- **correction-heavy**: 20%+ of user messages start with "no", "wrong", "wait"
- **keep-going-loop**: User repeatedly says "keep going" / "continue"
- **repeated-instructions**: Same instruction rephrased within 5 turns (Jaccard >60%)
- **negative-drift**: Messages get shorter and more corrective over time
- **rapid-corrections**: User responds within 10s of agent output
- **high-turn-ratio**: User sends 1.5x+ messages per agent response

#### **Sentiment Signals** (`sentiment.ts`)
Uses AFINN-165 lexicon with custom tokens for agent-specific phrases:
```typescript
{
  undo: -3, revert: -3, wrong: -3,
  "start over": -4, "not what i": -4,
  broken: -2, "doesn't work": -3, ...
}
```

Generates:
- **negative-sentiment**: Average sentiment score below threshold
- **extreme-frustration**: Individual messages with very low scores
- **user-interrupts**: User forcibly stops agent execution

### 3. **Report Generation** (`reporter.ts`)

Creates comprehensive analysis reports:
- Aggregates signals across all sessions
- Calculates project health scores
- Ranks projects by severity (worst first)
- Groups signals by type and frequency

Output formats:
- **Markdown**: Human-readable report with badges (CRIT, HIGH, MED, LOW)
- **JSON**: Machine-readable data structure

### 4. **Rule Suggestion** (`suggestions.ts`)

Automatically generates actionable rules from detected patterns:

| Signal | Generated Rule |
|--------|---------------|
| `edit-thrashing` | "Read the full file before editing. Plan all changes, then make ONE complete edit." |
| `error-loop` | "After 2 consecutive tool failures, stop and change your approach entirely." |
| `correction-heavy` | "When the user corrects you, stop and re-read their message." |
| `keep-going-loop` | "Complete the FULL task before stopping." |
| `negative-drift` | "Every few turns, re-read the original request to make sure you haven't drifted." |

### 5. **Model Persistence** (`model.ts`)

Saves analysis results to `.claude-doctor/`:
- `model.json`: Signal baselines, project profiles, session counts
- `guidance.md`: Agent-readable rules for runtime hooks

Enables:
- Incremental learning from historical sessions
- Project-specific rule recommendations
- Real-time session health checking

### 6. **Visualization** (`viz.ts`)

Terminal UI with ANSI color codes:
- **Health bars**: █████░░░░░ (green/yellow/red)
- **Timeline**: Visual representation of session quality over turns
- **Signal badges**: Color-coded severity indicators
- **Problem turns**: Highlighted problematic user messages

## CLI Usage

```bash
# Analyze all sessions
claude-doctor

# Check specific session
claude-doctor <session-id>
claude-doctor <path/to.jsonl>

# Filter by project
claude-doctor -p myproject

# Generate rules for CLAUDE.md/AGENTS.md
claude-doctor --rules

# Save model for future analysis
claude-doctor --save

# Output as JSON
claude-doctor --json
```

## Key Constants & Thresholds

From `constants.ts`:

```typescript
// Thrashing
THRASHING_EDIT_THRESHOLD = 5            // Edits to flag a file
THRASHING_SEVERITY_CRITICAL = 20        // Critical severity threshold

// Error Loops
ERROR_LOOP_THRESHOLD = 3                // Consecutive failures to flag
ERROR_LOOP_CRITICAL_THRESHOLD = 5       // Critical threshold

// Sentiment
SENTIMENT_NEGATIVE_THRESHOLD = -1       // Flag negative sentiment
SENTIMENT_CRITICAL_THRESHOLD = -3       // Critical frustration
INTERRUPT_CRITICAL_THRESHOLD = 3        // Multiple interrupts

// Behavioral
CORRECTION_RATE_THRESHOLD = 0.2         // 20% corrections
KEEP_GOING_MIN_TO_FLAG = 2              // "Keep going" instances
REPETITION_SIMILARITY_THRESHOLD = 0.6   // Jaccard similarity
RAPID_FOLLOWUP_MS = 10_000              // 10 second response window
HIGH_TURN_RATIO_THRESHOLD = 1.5         // User:assistant message ratio
```

## Data Flow

```
1. Discovery: Scan ~/.claude/projects/
2. Indexing: Build session metadata (times, counts, paths)
3. Parsing: Read JSONL transcripts into structured events
4. Analysis: Run signal detectors on each session
5. Aggregation: Combine signals across projects
6. Scoring: Calculate health scores per project
7. Suggestion: Generate rules from signal patterns
8. Output: Render reports (markdown/JSON/terminal UI)
```

## Type System

Key interfaces from `types.d.ts`:

- `TranscriptEvent`: Union of user/assistant/queue events
- `SessionMetadata`: Session stats (message counts, errors, duration)
- `ProjectMetadata`: Collection of sessions for a project
- `SignalResult`: Detected issue with severity, score, examples
- `AnalysisReport`: Complete analysis output
- `SavedModel`: Persisted learning model
- `CheckResult`: Single session health check result

## External Dependencies

```json
{
  "commander": "^14.0.3",      // CLI argument parsing
  "sentiment": "^5.0.2"        // AFINN-165 sentiment analysis
}
```

## Development Workflow

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Development watch mode
pnpm dev

# Run tests
pnpm test

# Lint + format check
pnpm check
```

## Design Patterns

1. **Pipeline Architecture**: Sequential processing stages (parse → detect → aggregate → report)
2. **Signal Pattern**: Modular detector functions that return standardized `SignalResult[]`
3. **Visitor Pattern**: Event traversal with type guards (`isUserEvent`, `isAssistantEvent`)
4. **Strategy Pattern**: Swappable output formats (markdown, JSON, terminal)
5. **Builder Pattern**: Incremental construction of reports and timelines

## Performance Considerations

- Streams JSONL files line-by-line (no full file buffering)
- Filters meta-messages early to reduce processing
- Caps user message length (2000 chars) to avoid outliers
- Sorts signals once after all detection
- Limits display output (top 20 signals, 10 projects, 5 examples)

## Extension Points

To add a new signal detector:

1. Create `signals/my-signal.ts`
2. Export function: `detectMySignal(filePath, sessionId): Promise<SignalResult[]>`
3. Import in `reporter.ts` and call in `analyzeProject()`
4. Add suggestion mapping in `suggestions.ts`
5. Add constants to `constants.ts`
6. Update type definitions in `types.d.ts` if needed

## Future Enhancements (Potential)

Based on the codebase structure:
- Real-time session monitoring (watch mode)
- Web dashboard for multi-user teams
- Integration with CI/CD pipelines
- Machine learning for adaptive thresholds
- Support for other AI coding tools beyond Claude
- Historical trend analysis over time

---

**Generated:** 2026-04-15  
**Tool Version:** claude-doctor v0.0.3
