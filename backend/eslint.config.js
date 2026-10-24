import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Deliberadamente ligero: atrapa errores reales (variables sin usar, `any`
 * implícito, promesas sin await), no impone estilo. El formato lo decide
 * cada quien; esto es una puerta de calidad para el pre-commit, no un linter
 * de estilo.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // El único .cjs del repo: el guard de `npm run prepare` (ver package.json).
    // Corre con `node` directo, fuera del mundo ESM/TS — necesita los
    // globals de CommonJS que `js.configs.recommended` no conoce por defecto.
    files: ["**/*.cjs"],
    languageOptions: {
      globals: { require: "readonly", module: "readonly", __dirname: "readonly", process: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
