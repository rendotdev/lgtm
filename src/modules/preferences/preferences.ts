import { build } from "../../builder.ts";

export type DiffStyle = "unified" | "split";
export type FileExpansion = "auto" | "expanded" | "collapsed";
export type FileExpansionOverride = Exclude<FileExpansion, "auto">;

export type LgtmPreferences = {
  diffStyle: DiffStyle;
  lineWrap: boolean;
  sidebarWidth: number;
  fileExpansion: FileExpansion;
  fileExpansionOverrides: Record<string, FileExpansionOverride>;
};

export const { LgtmPreferencesSingleton, LgtmPreferencesSingletonBuilder } = build().singleton(
  "LgtmPreferencesSingleton",
  {
    build() {
      const defaults: LgtmPreferences = {
        diffStyle: "unified",
        lineWrap: false,
        sidebarWidth: 256,
        fileExpansion: "auto",
        fileExpansionOverrides: {},
      };

      return {
        defaults,

        parse(params: { value: unknown }): LgtmPreferences {
          const isMissingValue = params.value === undefined || params.value === null;
          if (isMissingValue) {
            return { ...defaults };
          }
          const isInvalidValue = typeof params.value !== "object" || Array.isArray(params.value);
          if (isInvalidValue) {
            throw new Error("LGTM preferences must be an object.");
          }

          const preferences = params.value as {
            diffStyle?: unknown;
            lineWrap?: unknown;
            sidebarWidth?: unknown;
            fileExpansion?: unknown;
            fileExpansionOverrides?: unknown;
          };
          const diffStyle = preferences.diffStyle ?? defaults.diffStyle;
          const isInvalidDiffStyle = diffStyle !== "unified" && diffStyle !== "split";
          if (isInvalidDiffStyle) {
            throw new Error('diffStyle must be "unified" or "split".');
          }
          const lineWrap = preferences.lineWrap ?? defaults.lineWrap;
          if (typeof lineWrap !== "boolean") {
            throw new Error("lineWrap must be a boolean.");
          }
          const sidebarWidth = preferences.sidebarWidth ?? defaults.sidebarWidth;
          const isInvalidSidebarWidth =
            typeof sidebarWidth !== "number" ||
            !Number.isInteger(sidebarWidth) ||
            sidebarWidth < 192 ||
            sidebarWidth > 480;
          if (isInvalidSidebarWidth) {
            throw new Error("sidebarWidth must be an integer between 192 and 480.");
          }
          const fileExpansion = preferences.fileExpansion ?? defaults.fileExpansion;
          const isInvalidFileExpansion =
            fileExpansion !== "auto" &&
            fileExpansion !== "expanded" &&
            fileExpansion !== "collapsed";
          if (isInvalidFileExpansion) {
            throw new Error('fileExpansion must be "auto", "expanded", or "collapsed".');
          }
          const fileExpansionOverridesValue =
            preferences.fileExpansionOverrides ?? defaults.fileExpansionOverrides;
          const isInvalidFileExpansionOverrides =
            typeof fileExpansionOverridesValue !== "object" ||
            fileExpansionOverridesValue === null ||
            Array.isArray(fileExpansionOverridesValue);
          if (isInvalidFileExpansionOverrides) {
            throw new Error("fileExpansionOverrides must be an object.");
          }
          const fileExpansionOverrides: Record<string, FileExpansionOverride> = {};
          for (const [location, override] of Object.entries(fileExpansionOverridesValue)) {
            const isInvalidOverride = override !== "expanded" && override !== "collapsed";
            if (isInvalidOverride) {
              throw new Error('fileExpansionOverrides values must be "expanded" or "collapsed".');
            }
            fileExpansionOverrides[location] = override;
          }
          return { diffStyle, lineWrap, sidebarWidth, fileExpansion, fileExpansionOverrides };
        },
      };
    },
  },
);
