/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/consistent-type-imports": "error",
    // The frontmatter parser intentionally matches the literal U+FEFF
    // BOM character; the regex needs to contain it directly because
    // string equality must match the raw byte. Allow irregular
    // whitespace inside string and regex literals only.
    "no-irregular-whitespace": ["error", { skipStrings: true, skipRegExps: true }],
  },
  ignorePatterns: ["dist/", "node_modules/", "templates/", "coverage/"],
  overrides: [
    {
      files: ["tests/**/*.ts"],
      env: { node: true },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
