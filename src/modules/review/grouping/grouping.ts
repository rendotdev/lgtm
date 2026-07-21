import { build } from "../../../builder.ts";
import type { ReviewGroup, ReviewGroupInput, ReviewSourceFile } from "../review/review.ts";

export const { ReviewGroupingService, ReviewGroupingServiceBuilder } = build().service(
  "ReviewGroupingService",
  {
    config: { fallbackTitle: "Other changes" },
    deps: {},
    build({ config }) {
      function buildGroups(params: {
        files: ReviewSourceFile[];
        groups: ReviewGroupInput[] | undefined;
      }): ReviewGroup[] | undefined {
        if (!params.groups) {
          return undefined;
        }

        const changedLocations = new Set(params.files.map((file) => file.location));
        const assignedLocations = new Set<string>();
        const groups: ReviewGroup[] = [];

        for (const inputGroup of params.groups) {
          const title = inputGroup.title.trim();
          if (!title) {
            continue;
          }
          const files = inputGroup.files.filter(function includeLocation(location) {
            const shouldSkipLocation =
              !changedLocations.has(location) || assignedLocations.has(location);
            if (shouldSkipLocation) {
              return false;
            }
            assignedLocations.add(location);
            return true;
          });
          if (files.length > 0) {
            groups.push({ title, files });
          }
        }

        const unassignedFiles = params.files
          .map(function getLocation(file) {
            return file.location;
          })
          .filter(function isUnassigned(location) {
            return !assignedLocations.has(location);
          });
        if (unassignedFiles.length > 0) {
          groups.push({ title: config.fallbackTitle, files: unassignedFiles });
        }

        return groups;
      }

      return { build: buildGroups };
    },
  },
);
