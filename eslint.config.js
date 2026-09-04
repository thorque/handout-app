import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "data/**", "coverage/**"] },

  js.configs.recommended,

  // Server-side source and tests: Node ESM. src/public/** is excluded here —
  // it is browser code, not Node, and gets its own block below.
  {
    files: ["src/**/*.js", "test/**/*.js", "eslint.config.js"],
    ignores: ["src/public/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },

  // node-pg-migrate reads CommonJS migration files (see src/migrate.js's
  // comment on the .cjs extension) — a third environment, distinct from the
  // ESM used everywhere else in src/ and test/.
  {
    files: ["migrations/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        module: "writable",
        exports: "writable",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
  },

  // src/public/*.js ships to the browser as-is (no bundler, no build step)
  // and is written as a single IIFE with `var` for maximum compatibility —
  // not Node ESM, so it needs browser globals and sourceType "script"
  // rather than the Node block above. Linting it as ESM would flag every
  // browser global as undefined and `var` itself as a module-scope leak.
  {
    files: ["src/public/*.js"],
    languageOptions: {
      // 2019 for optional catch binding (`catch {}`), used for the
      // feature-detected try/catches around localStorage and JSON.parse.
      ecmaVersion: 2019,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        FormData: "readonly",
        XMLHttpRequest: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
];
