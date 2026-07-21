import { join } from "node:path";
import { build } from "../../../../builder.ts";
import { ApiRouteSingleton, type ApiRouteRequest } from "../route/route.ts";
import { reviewSchema } from "../schemas/schemas.ts";

export const { ReviewPutApiRouteService, ReviewPutApiRouteServiceBuilder } = build().service(
  "ReviewPutApiRouteService",
  {
    config: { reviewPath: join(process.cwd(), ".lgtm", "review.json") },
    deps: {},
    build({ config }) {
      async function handle(params: ApiRouteRequest): Promise<boolean> {
        if (!ApiRouteSingleton.matches({ ...params, method: "PUT", path: "/api/review" })) {
          return false;
        }
        const review = await ApiRouteSingleton.readRequest({
          request: params.request,
          schema: reviewSchema,
        });
        const nextReview = await ApiRouteSingleton.writeJsonFile({
          path: config.reviewPath,
          schema: reviewSchema,
          value: { ...review, updatedAt: new Date().toISOString() },
        });
        ApiRouteSingleton.send({
          response: params.response,
          status: 200,
          schema: reviewSchema,
          value: nextReview,
        });
        return true;
      }

      return { handle };
    },
  },
);
