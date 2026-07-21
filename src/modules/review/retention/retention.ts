import { build } from "../../../builder.ts";

export const REVIEW_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export type ReviewManifest = {
  version: 1;
  reviewId: string;
  createdAt: string;
  expiresAt: string;
};

export const { ReviewRetentionService, ReviewRetentionServiceBuilder } = build().service(
  "ReviewRetentionService",
  {
    config: { retentionMilliseconds: REVIEW_RETENTION_MILLISECONDS },
    deps: {},
    build({ config }) {
      function expiresAt(params: { createdAt: string }): string {
        const createdAt = Date.parse(params.createdAt);
        if (!Number.isFinite(createdAt)) {
          throw new Error("Review createdAt must be a valid date.");
        }
        return new Date(createdAt + config.retentionMilliseconds).toISOString();
      }

      function createManifest(params: { reviewId: string; createdAt: string }): ReviewManifest {
        return {
          version: 1,
          reviewId: params.reviewId,
          createdAt: params.createdAt,
          expiresAt: expiresAt({ createdAt: params.createdAt }),
        };
      }

      function isExpired(params: { expiresAt: string; now: Date }): boolean {
        const expirationTime = Date.parse(params.expiresAt);
        if (!Number.isFinite(expirationTime)) {
          return false;
        }
        return expirationTime <= params.now.getTime();
      }

      return { createManifest, expiresAt, isExpired };
    },
  },
);
