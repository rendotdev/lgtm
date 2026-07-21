import { build } from "../../builder.ts";
import type { ReviewJson, ReviewPayload } from "../../modules/review/review/review.ts";

export type ReviewAppState = {
  payload: ReviewPayload;
  review: ReviewJson;
};

export const { ReviewApiService, ReviewApiServiceBuilder } = build().service("ReviewApiService", {
  config: {},
  deps: { fetch: globalThis.fetch },
  build({ deps }) {
    const fetchRequest = deps.fetch.bind(globalThis);

    async function readReview(params: {
      response: Response;
      failureMessage: string;
    }): Promise<ReviewJson> {
      if (!params.response.ok) {
        const details = await params.response.text();
        throw new Error(details || params.failureMessage);
      }
      return (await params.response.json()) as ReviewJson;
    }

    async function load(params: {}): Promise<ReviewAppState> {
      void params;
      const [payloadResponse, reviewResponse] = await Promise.all([
        fetchRequest("/api/payload"),
        fetchRequest("/api/review"),
      ]);
      if (!payloadResponse.ok) {
        throw new Error("Failed to load payload.");
      }
      if (!reviewResponse.ok) {
        throw new Error("Failed to load review.");
      }
      return {
        payload: (await payloadResponse.json()) as ReviewPayload,
        review: (await reviewResponse.json()) as ReviewJson,
      };
    }

    async function save(params: { review: ReviewJson }): Promise<ReviewJson> {
      const response = await fetchRequest("/api/review", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params.review),
      });
      return await readReview({ response, failureMessage: "Failed to save review." });
    }

    async function finish(params: {
      decision: "approved" | "changes_requested";
    }): Promise<ReviewJson> {
      const response = await fetchRequest("/api/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: params.decision }),
      });
      return await readReview({ response, failureMessage: "Failed to finish review." });
    }

    async function cancel(params: {}): Promise<ReviewJson> {
      void params;
      const response = await fetchRequest("/api/cancel", { method: "POST" });
      return await readReview({ response, failureMessage: "Failed to cancel review." });
    }

    return { cancel, finish, load, save };
  },
});
