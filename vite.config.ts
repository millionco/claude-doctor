import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{js,ts,tsx}": "vp check --fix",
  },
  lint: {
    ignorePatterns: ["archive", ".next", "dist"],
    plugins: ["typescript", "react", "import"],
    rules: {
      "require-yield": "off",
    },
  },
  fmt: {
    semi: true,
    singleQuote: false,
    ignorePatterns: ["archive", ".next", "dist", ".changeset"],
  },
});
