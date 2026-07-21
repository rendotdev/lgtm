import { build } from "../../builder.ts";
import type { ReviewJson } from "../../modules/review/review/review.ts";

export const { CommentDraftService, CommentDraftServiceBuilder } = build().service(
  "CommentDraftService",
  {
    config: { syncWaitMs: 250 },
    deps: {
      clearTimeout: function clearScheduledTimeout(handle: number) {
        globalThis.clearTimeout(handle);
      },
      now: function now() {
        return new Date();
      },
      setTimeout: function scheduleTimeout(callback: () => void, milliseconds: number): number {
        return globalThis.setTimeout(callback, milliseconds) as unknown as number;
      },
    },
    build({ config, deps }) {
      const values = new Map<string, string>();
      const syncTimers = new Map<string, number>();

      function clearScheduledSync(params: { id: string }): void {
        const handle = syncTimers.get(params.id);
        if (handle === undefined) {
          return;
        }
        deps.clearTimeout(handle);
        syncTimers.delete(params.id);
      }

      function value(params: { fallback: string; id: string }): string {
        return values.get(params.id) ?? params.fallback;
      }

      function update(params: {
        id: string;
        onSync: (value: string) => void;
        value: string;
      }): void {
        values.set(params.id, params.value);
        clearScheduledSync({ id: params.id });
        const handle = deps.setTimeout(function syncDraft() {
          syncTimers.delete(params.id);
          const draft = values.get(params.id);
          if (draft !== undefined) {
            params.onSync(draft);
          }
        }, config.syncWaitMs);
        syncTimers.set(params.id, handle);
      }

      function remove(params: { id: string }): void {
        clearScheduledSync(params);
        values.delete(params.id);
      }

      function finish(params: {
        id: string;
        value: string;
        onDelete: () => void;
        onFinish: (value: string) => void;
      }): void {
        remove({ id: params.id });
        if (params.value.trim().length === 0) {
          params.onDelete();
          return;
        }
        params.onFinish(params.value);
      }

      function applyToReview(params: { review: ReviewJson }): ReviewJson {
        let changed = false;
        const updatedAt = deps.now().toISOString();
        const files = params.review.files.map(function applyFileDrafts(file) {
          return {
            ...file,
            comments: file.comments.map(function applyCommentDraft(comment) {
              const draft = values.get(comment.id);
              const shouldApplyDraft = draft !== undefined && draft !== comment.comment;
              if (!shouldApplyDraft) {
                return comment;
              }
              changed = true;
              return { ...comment, comment: draft, updatedAt };
            }),
          };
        });
        const documentComments = params.review.documentComments.map(
          function applyDocumentCommentDraft(comment) {
            const draft = values.get(comment.id);
            const shouldApplyDraft = draft !== undefined && draft !== comment.comment;
            if (!shouldApplyDraft) {
              return comment;
            }
            changed = true;
            return { ...comment, comment: draft, updatedAt };
          },
        );
        if (!changed) {
          return params.review;
        }
        return { ...params.review, updatedAt, files, documentComments };
      }

      return { applyToReview, finish, remove, update, value };
    },
  },
);
