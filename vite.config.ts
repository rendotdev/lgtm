import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["dist/**", ".lgtm/**"],
    sortPackageJson: true,
  },
  lint: {
    ignorePatterns: ["dist/**", ".lgtm/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
  pack: {
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    clean: true,
  },
});
