import { build } from "../../../../builder.ts";
import { ApiRouteSingleton, type ApiRouteRequest } from "../route/route.ts";
import { healthSchema } from "../schemas/schemas.ts";

export const { HealthApiRouteService, HealthApiRouteServiceBuilder } = build().service(
  "HealthApiRouteService",
  {
    config: {},
    deps: {},
    build() {
      async function handle(params: ApiRouteRequest): Promise<boolean> {
        if (!ApiRouteSingleton.matches({ ...params, method: "GET", path: "/health" })) {
          return false;
        }
        ApiRouteSingleton.send({
          response: params.response,
          status: 200,
          schema: healthSchema,
          value: { ok: true },
        });
        return true;
      }

      return { handle };
    },
  },
);
