import { build } from "../../builder.ts";
import type { LgtmPreferences } from "../../modules/preferences/preferences.ts";

export const { PreferencesApiService, PreferencesApiServiceBuilder } = build().service(
  "PreferencesApiService",
  {
    config: {},
    deps: { fetch: globalThis.fetch },
    build({ deps }) {
      const fetchRequest = deps.fetch.bind(globalThis);

      async function get(params: {}): Promise<LgtmPreferences> {
        void params;
        const response = await fetchRequest("/api/preferences");
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return (await response.json()) as LgtmPreferences;
      }

      async function update(params: { preferences: LgtmPreferences }): Promise<LgtmPreferences> {
        const response = await fetchRequest("/api/preferences", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params.preferences),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return (await response.json()) as LgtmPreferences;
      }

      return { get, update };
    },
  },
);
