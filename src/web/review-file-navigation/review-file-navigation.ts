import { build } from "../../builder.ts";

export const { ReviewFileNavigationService, ReviewFileNavigationServiceBuilder } = build().service(
  "ReviewFileNavigationService",
  {
    config: { parameterName: "file" },
    deps: {},
    build({ config }) {
      function read(params: { search: string }): string | null {
        const value = new URLSearchParams(params.search).get(config.parameterName);
        return value?.trim() ? value : null;
      }

      function createHref(params: { href: string; fileLocation: string }): string {
        const url = new URL(params.href);
        url.searchParams.set(config.parameterName, params.fileLocation);
        return `${url.pathname}${url.search}${url.hash}`;
      }

      return { createHref, read };
    },
  },
);
