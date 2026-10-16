// ESLint flat config.
//
// `next lint` was removed in Next 16, so `npm run lint` used to fail with "Invalid project
// directory provided, no such directory: .../lint": Next read the word `lint` as a positional path.
// The lint entrypoint now calls eslint directly against this file.
//
// `eslint-config-next` is pinned exact to the same version as `next` itself, so the rule set and
// the framework never drift apart. The gate runs with `--max-warnings=0`, so a warning fails the
// build the same way an error does.
import next from "eslint-config-next/core-web-vitals";

/**
 * The React Compiler rule family, newly promoted to `error` in eslint-config-next 16.
 *
 * These four rules check the invariants the React Compiler needs in order to memoise a component
 * automatically. This app does not enable the React Compiler (`reactCompiler` is unset in
 * next.config.ts), so they are advisory here rather than correctness checks, and several of the
 * reports are false on correct code: `apex.current = {...}` inside a pointer handler in
 * components/nav.tsx is legal React that the rule flags because it cannot prove statically that the
 * handler runs outside render.
 *
 * They stay reportable rather than deleted. `npm run lint:react-compiler` turns the whole family
 * back on, so the count is one command away and the signal is not lost. Turn these back to `error`
 * in the same commit that enables the React Compiler.
 */
const reactCompilerRules = {
  "react-hooks/refs": "off",
  "react-hooks/set-state-in-effect": "off",
  "react-hooks/immutability": "off",
  "react-hooks/purity": "off",
};

/**
 * The one standing exception. The OG image is drawn by Satori on the server, which implements a
 * subset of CSS and knows nothing about next/image, so `<img>` is the only element it can render.
 * Every other rule is at full strength for every file.
 */
const exceptions = [
  {
    files: ["app/og.png/route.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
];

const config = [
  {
    // Build output, dependencies and the sub-packages that carry their own toolchain. The contracts
    // are Solidity, and the indexer and cre are typechecked by their own tsconfig, so linting them
    // from the root config would report on code this config was not written for.
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "contracts/**",
      "indexer/**",
      "cre/**",
      // Type declarations for a plain .mjs script. The parser here reads them as JavaScript.
      "scripts/*.d.mts",
      "verifier/node_modules/**",
      "public/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  {
    // The `@typescript-eslint` plugin is only registered for TypeScript files by the preset, so a
    // rule from it has to be scoped the same way. Without the `files` filter eslint reports the
    // plugin as missing when it reaches a plain `.mjs` config or script.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // An unused binding is usually a half-finished edit, and on a payment or verdict path a
      // dropped binding is the shape of a real bug. A leading underscore is the way to say a
      // parameter is deliberately ignored.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  // `LINT_REACT_COMPILER=1 npx eslint .` reports the family instead of skipping it.
  ...(process.env.LINT_REACT_COMPILER === "1" ? [] : [{ rules: reactCompilerRules }]),
  ...exceptions,
];

export default config;
