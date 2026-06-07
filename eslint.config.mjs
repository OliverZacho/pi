// Flat ESLint config for Next.js 16 + ESLint 9.
//
// Next 16 removed the bundled `next lint` command, so linting now runs
// through the ESLint CLI directly (see the `lint` script in package.json).
// `eslint-config-next/core-web-vitals` already bundles the Next, React,
// React-hooks, import, jsx-a11y and TypeScript flat configs plus the
// default global ignores (`.next/`, `out/`, `build/`, `next-env.d.ts`).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  {
    // Build artifacts that aren't covered by the bundled defaults.
    ignores: ["tsconfig.tsbuildinfo", "coverage/**"]
  },
  {
    rules: {
      // `eslint-config-next@16` bundles `eslint-plugin-react-hooks` v6,
      // which ships the React-Compiler-era rules below as errors. They
      // flag deliberate, long-standing patterns across the app (syncing
      // props→state in an effect, mirroring the latest value into a ref
      // for use in event handlers, reading `Date.now()` in render of
      // static copy, etc.). Refactoring every site is a large, risky
      // change unrelated to feature work, so we keep these visible as
      // warnings and chip away at them over time rather than block lint.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // Cosmetic: unescaped quotes/apostrophes in JSX text render fine.
      // Kept as a warning so genuinely broken entities still surface.
      "react/no-unescaped-entities": "warn"
    }
  }
];

export default config;
