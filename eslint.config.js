// ESLint (flat config) da UI — `npm run lint`.
//
// Estrito onde o código já é limpo e avisos no resto, para o CI ficar verde HOJE
// sem esconder a dívida:
//   • STRICT — ui-app/src/features/*/domain/** (o alvo da Clean Architecture): todas as
//     regras recomendadas do ESLint + typescript-eslint são ERRO, incluindo
//     no-explicit-any e ban-ts-comment. Código novo nasce aqui.
//   • LEGACY — o resto de ui-app/src (monólito em migração, 12 ficheiros com
//     @ts-nocheck): as mesmas regras, rebaixadas a AVISO. Quando um ficheiro sai do
//     monólito para domain/application/…, passa automaticamente a estrito.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// core.ts fica de fora por agora: a interface Window é o contrato com o monólito e os
// seus `any` só desaparecem quando o estado sair do window (store tipado).
const STRICT = ["ui-app/src/features/*/domain/**/*.ts"];
// Dívida conhecida, fora do perímetro estrito até ser tipada: o interpretador do
// visualizer ainda tem @ts-nocheck (dentro da baseline do arch-check).
const STRICT_EXCEPT = ["ui-app/src/features/visualizer/domain/interpreter.ts"];

/** Copia uma lista de configs com todas as regras activas rebaixadas a "warn". */
const asWarnings = (configs) =>
  configs.map((c) =>
    c.rules
      ? {
          ...c,
          rules: Object.fromEntries(
            Object.entries(c.rules).map(([k, v]) => {
              const sev = Array.isArray(v) ? v[0] : v;
              if (sev === "off" || sev === 0) return [k, v];
              return [k, Array.isArray(v) ? ["warn", ...v.slice(1)] : "warn"];
            }),
          ),
        }
      : c,
  );

const recommended = [js.configs.recommended, ...tseslint.configs.recommended];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "src-tauri/**",
      "crates/**",
      "ui-app/public/**",
      "ui/**",
      "ui-next/**",
    ],
  },
  {
    files: ["ui-app/src/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  ...asWarnings(recommended).map((c) => ({ ...c, files: ["ui-app/src/**/*.ts"], ignores: STRICT })),
  ...asWarnings(recommended).map((c) => ({ ...c, files: STRICT_EXCEPT })),
  ...recommended.map((c) => ({ ...c, files: STRICT, ignores: STRICT_EXCEPT })),
  {
    files: STRICT,
    ignores: STRICT_EXCEPT,
    rules: {
      // parâmetros/variáveis prefixados com _ são intencionalmente não usados
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
);
