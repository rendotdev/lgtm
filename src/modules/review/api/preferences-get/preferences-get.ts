import { build } from "../../../../builder.ts";
import { PreferencesStoreService } from "../../../preferences/store/store.ts";
import { ApiRouteSingleton, type ApiRouteRequest } from "../route/route.ts";
import { preferencesSchema } from "../schemas/schemas.ts";

export const { PreferencesGetApiRouteService, PreferencesGetApiRouteServiceBuilder } =
  build().service("PreferencesGetApiRouteService", {
    config: {},
    deps: { preferencesStore: PreferencesStoreService },
    build({ deps }) {
      async function handle(params: ApiRouteRequest): Promise<boolean> {
        if (!ApiRouteSingleton.matches({ ...params, method: "GET", path: "/api/preferences" })) {
          return false;
        }
        const preferences = preferencesSchema.parse(await deps.preferencesStore.read({}));
        ApiRouteSingleton.send({
          response: params.response,
          status: 200,
          schema: preferencesSchema,
          value: preferences,
        });
        return true;
      }

      return { handle };
    },
  });
