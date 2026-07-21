import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { build } from "../../../builder.ts";
import { LgtmPreferencesSingleton, type LgtmPreferences } from "../preferences.ts";

export const { PreferencesStoreService, PreferencesStoreServiceBuilder } = build().service(
  "PreferencesStoreService",
  {
    config: { cwd: process.cwd() },
    deps: {},
    build({ config }) {
      const path = join(config.cwd, ".lgtm", "lgtm.jsonc");

      async function readSource() {
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
          }
          throw error;
        }
      }

      function parseSource(params: { source: string }) {
        const errors: ParseError[] = [];
        const value = parse(params.source, errors, { allowTrailingComma: true });
        if (errors.length > 0) {
          throw new Error("Unable to parse .lgtm/lgtm.jsonc.");
        }
        return value as unknown;
      }

      return {
        getPath(params: {}) {
          void params;
          return path;
        },

        async read(params: {}): Promise<LgtmPreferences> {
          void params;
          const source = await readSource();
          if (source === undefined) {
            return { ...LgtmPreferencesSingleton.defaults };
          }
          return LgtmPreferencesSingleton.parse({ value: parseSource({ source }) });
        },

        async write(params: { preferences: LgtmPreferences }): Promise<LgtmPreferences> {
          const preferences = LgtmPreferencesSingleton.parse({ value: params.preferences });
          const source = (await readSource()) ?? "{}\n";
          parseSource({ source });
          const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
          const diffStyleSource = applyEdits(
            source,
            modify(source, ["diffStyle"], preferences.diffStyle, { formattingOptions }),
          );
          const lineWrapSource = applyEdits(
            diffStyleSource,
            modify(diffStyleSource, ["lineWrap"], preferences.lineWrap, { formattingOptions }),
          );
          const sidebarWidthSource = applyEdits(
            lineWrapSource,
            modify(lineWrapSource, ["sidebarWidth"], preferences.sidebarWidth, {
              formattingOptions,
            }),
          );
          const fileExpansionSource = applyEdits(
            sidebarWidthSource,
            modify(sidebarWidthSource, ["fileExpansion"], preferences.fileExpansion, {
              formattingOptions,
            }),
          );
          const updatedSource = applyEdits(
            fileExpansionSource,
            modify(
              fileExpansionSource,
              ["fileExpansionOverrides"],
              preferences.fileExpansionOverrides,
              { formattingOptions },
            ),
          );
          await mkdir(join(config.cwd, ".lgtm"), { recursive: true });
          const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporaryPath, updatedSource, "utf8");
            await rename(temporaryPath, path);
          } finally {
            await rm(temporaryPath, { force: true });
          }
          return preferences;
        },
      };
    },
  },
);
