import { build } from "../../../../builder.ts";
import { PreferencesStoreService } from "../../../preferences/store/store.ts";
import { ApiRouteSingleton, type ApiRouteRequest } from "../route/route.ts";
import { preferencesSchema } from "../schemas/schemas.ts";

export const { PreferencesPutApiRouteService, PreferencesPutApiRouteServiceBuilder } =
  build().service("PreferencesPutApiRouteService", {
    config: {},
    deps: { preferencesStore: PreferencesStoreService },
    build({ deps }) {
      async function handle(params: ApiRouteRequest): Promise<boolean> {
        if (!ApiRouteSingleton.matches({ ...params, method: "PUT", path: "/api/preferences" })) {
          return false;
        }
        const preferences = await ApiRouteSingleton.readRequest({
          request: params.request,
          schema: preferencesSchema,
        });
        const savedPreferences = preferencesSchema.parse(
          await deps.preferencesStore.write({ preferences }),
        );
        ApiRouteSingleton.send({
          response: params.response,
          status: 200,
          schema: preferencesSchema,
          value: savedPreferences,
        });
        return true;
      }

      return { handle };
    },
  });
