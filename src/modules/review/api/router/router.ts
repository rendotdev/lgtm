import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { build } from "../../../../builder.ts";
import { PreferencesStoreService } from "../../../preferences/store/store.ts";
import { CancelApiRouteServiceBuilder } from "../cancel/cancel.ts";
import { FinishApiRouteServiceBuilder } from "../finish/finish.ts";
import { HealthApiRouteService } from "../health/health.ts";
import { PayloadApiRouteServiceBuilder } from "../payload/payload.ts";
import { PreferencesGetApiRouteServiceBuilder } from "../preferences-get/preferences-get.ts";
import { PreferencesPutApiRouteServiceBuilder } from "../preferences-put/preferences-put.ts";
import { ReviewGetApiRouteServiceBuilder } from "../review-get/review-get.ts";
import { ReviewPutApiRouteServiceBuilder } from "../review-put/review-put.ts";
import type { ApiRoute, ApiRouteRequest } from "../route/route.ts";
import { errorSchema } from "../schemas/schemas.ts";

export const { ReviewApiRouterService, ReviewApiRouterServiceBuilder } = build().service(
  "ReviewApiRouterService",
  {
    config: {
      payloadPath: join(process.cwd(), ".lgtm", "payload.json"),
      reviewPath: join(process.cwd(), ".lgtm", "review.json"),
    },
    deps: {
      closeServer: function closeServer() {},
      preferencesStore: PreferencesStoreService,
    },
    build({ config, deps }) {
      const routes: ApiRoute[] = [
        PayloadApiRouteServiceBuilder({
          config: { payloadPath: config.payloadPath },
          deps: {},
        }),
        ReviewGetApiRouteServiceBuilder({
          config: { reviewPath: config.reviewPath },
          deps: {},
        }),
        ReviewPutApiRouteServiceBuilder({
          config: { reviewPath: config.reviewPath },
          deps: {},
        }),
        PreferencesGetApiRouteServiceBuilder({
          config: {},
          deps: { preferencesStore: deps.preferencesStore },
        }),
        PreferencesPutApiRouteServiceBuilder({
          config: {},
          deps: { preferencesStore: deps.preferencesStore },
        }),
        FinishApiRouteServiceBuilder({
          config: { reviewPath: config.reviewPath },
          deps: { closeServer: deps.closeServer },
        }),
        CancelApiRouteServiceBuilder({
          config: { reviewPath: config.reviewPath },
          deps: { closeServer: deps.closeServer },
        }),
        HealthApiRouteService,
      ];

      async function handle(params: ApiRouteRequest): Promise<boolean> {
        for (const route of routes) {
          if (await route.handle(params)) {
            return true;
          }
        }
        return false;
      }

      function sendError(params: {
        response: ServerResponse;
        status: number;
        error: unknown;
      }): void {
        const error = params.error instanceof Error ? params.error.message : String(params.error);
        const body = Buffer.from(JSON.stringify(errorSchema.parse({ error })));
        params.response.writeHead(params.status, {
          "content-type": "application/json; charset=utf-8",
          "content-length": body.length,
          "cache-control": "no-store",
        });
        params.response.end(body);
      }

      return { handle, sendError };
    },
  },
);
