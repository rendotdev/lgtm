import { join } from "node:path";
import { build } from "../../../../builder.ts";
import { ApiRouteSingleton, type ApiRouteRequest } from "../route/route.ts";
import { finishRequestSchema, reviewSchema } from "../schemas/schemas.ts";

export const { FinishApiRouteService, FinishApiRouteServiceBuilder } = build().service(
  "FinishApiRouteService",
  {
    config: { reviewPath: join(process.cwd(), ".lgtm", "review.json") },
    deps: { closeServer: function closeServer() {} },
    build({ config, deps }) {
      async function handle(params: ApiRouteRequest): Promise<boolean> {
        if (!ApiRouteSingleton.matches({ ...params, method: "POST", path: "/api/finish" })) {
          return false;
        }
        const body = await ApiRouteSingleton.readRequest({
          request: params.request,
          schema: finishRequestSchema,
        });
        const review = await ApiRouteSingleton.readJsonFile({
          path: config.reviewPath,
          schema: reviewSchema,
        });
        const now = new Date().toISOString();
        const nextReview = await ApiRouteSingleton.writeJsonFile({
          path: config.reviewPath,
          schema: reviewSchema,
          value: { ...review, status: body.decision, updatedAt: now, finishedAt: now },
        });
        params.response.once("finish", deps.closeServer);
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
