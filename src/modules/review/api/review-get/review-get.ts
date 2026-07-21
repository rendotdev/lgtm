import { join } from "node:path";
import { build } from "../../../../builder.ts";
import { ApiRouteSingleton, type ApiRouteRequest } from "../route/route.ts";
import { reviewSchema } from "../schemas/schemas.ts";

export const { ReviewGetApiRouteService, ReviewGetApiRouteServiceBuilder } = build().service(
  "ReviewGetApiRouteService",
  {
    config: { reviewPath: join(process.cwd(), ".lgtm", "review.json") },
    deps: {},
    build({ config }) {
      async function handle(params: ApiRouteRequest): Promise<boolean> {
        if (!ApiRouteSingleton.matches({ ...params, method: "GET", path: "/api/review" })) {
          return false;
        }
        const review = await ApiRouteSingleton.readJsonFile({
          path: config.reviewPath,
          schema: reviewSchema,
        });
        ApiRouteSingleton.send({
          response: params.response,
          status: 200,
          schema: reviewSchema,
          value: review,
        });
        return true;
      }

      return { handle };
    },
  },
);
