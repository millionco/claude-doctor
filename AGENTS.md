## General Rules

- MUST: Use @antfu/ni. Use `ni` to install, `nr SCRIPT_NAME` to run. `nun` to uninstall.
- MUST: Use TypeScript interfaces over types.
- MUST: Keep all types in the global scope.
- MUST: Use arrow functions over function declarations
- MUST: Default to NO comments. Only add a comment when the user explicitly asks, or when the "why" is truly non-obvious — browser quirks, platform bugs, performance tradeoffs, fragile internal patching, or counter-intuitive design decisions. Never add comments that restate what the code does or what a well-named function/variable already conveys. When in doubt, leave the comment out.
  - Do not delete descriptive comments >3 lines without confirming with the user
- MUST: Use kebab-case for files
- MUST: Use descriptive names for variables (avoid shorthands, or 1-2 character names).
  - Example: for .map(), you can use `innerX` instead of `x`
  - Example: instead of `moved` use `didPositionChange`
- MUST: Frequently re-evaluate and refactor variable names to be more accurate and descriptive.
- MUST: Do not type cast ("as") unless absolutely necessary
- MUST: Remove unused code and don't repeat yourself.
- MUST: Always search the codebase, think of many solutions, then implement the most _elegant_ solution.
- MUST: Put all magic numbers in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes (`_MS`, `_PX`).
- MUST: Put small, focused utility functions in `utils/` with one utility per file.
- MUST: Use Boolean over !!.

## Testing

Run checks always before committing with:

```bash
pnpm check # runs lint + fmt
```

## Development instructions

This is a pnpm monorepo with `packages/` (libraries). No external services (databases, Docker, etc.) are required.

### Build before test

`pnpm build` must complete before running the CLI. After modifying source files, always rebuild.

### Key commands reference

See root `package.json` scripts. Quick reference:

- **Install**: `ni` (or `pnpm install`)
- **Build**: `nr build` (or `pnpm build`)
- **Lint**: `pnpm lint` — vite-plus lint
- **Format**: `pnpm fmt` — vite-plus fmt
- **Check**: `pnpm check` — lint + fmt combined
