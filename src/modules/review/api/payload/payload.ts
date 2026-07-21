import { join } from "node:path";
import { build } from "../../../../builder.ts";
import { ApiRouteSingleton, type ApiRouteRequest } from "../route/route.ts";
import { reviewPayloadSchema } from "../schemas/schemas.ts";

export const { PayloadApiRouteService, PayloadApiRouteServiceBuilder } = build().service(
  "PayloadApiRouteService",
  {
    config: { payloadPath: join(process.cwd(), ".lgtm", "payload.json") },
    deps: {},
    build({ config }) {
      async function handle(params: ApiRouteRequest): Promise<boolean> {
        if (!ApiRouteSingleton.matches({ ...params, method: "GET", path: "/api/payload" })) {
          return false;
        }
        const payload = await ApiRouteSingleton.readJsonFile({
          path: config.payloadPath,
          schema: reviewPayloadSchema,
        });
        ApiRouteSingleton.send({
          response: params.response,
          status: 200,
          schema: reviewPayloadSchema,
          value: payload,
        });
        return true;
      }

      return { handle };
    },
  },
);
