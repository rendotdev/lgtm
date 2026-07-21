import { toast } from "@heroui/react";
import { build } from "../../builder.ts";

export const { ToastNotificationsService, ToastNotificationsServiceBuilder } = build().service(
  "ToastNotificationsService",
  {
    config: {},
    deps: { showDanger: toast.danger, showSuccess: toast.success },
    build({ deps }) {
      function preferencesNotSaved(params: { error: unknown }): void {
        const detail = params.error instanceof Error ? params.error.message : String(params.error);
        void deps.showDanger(`Preferences not saved: ${detail}`);
      }

      function preferencesUnavailable(params: {}): void {
        void params;
        void deps.showDanger("Preferences unavailable");
      }

      function reviewUnavailable(params: {}): void {
        void params;
        void deps.showDanger("Review unavailable");
      }

      function commentsNotSaved(params: {}): void {
        void params;
        void deps.showDanger("Comments not saved");
      }

      function commentsCopied(params: {}): void {
        void params;
        void deps.showSuccess("Comments copied");
      }

      function commentsKeptInTab(params: {}): void {
        void params;
        void deps.showDanger("Comments kept in this tab");
      }

      function reviewNotFinished(params: {}): void {
        void params;
        void deps.showDanger("Review saved but not finished");
      }

      function copyFailed(params: {}): void {
        void params;
        void deps.showDanger("Copy failed");
      }

      function cancelFailed(params: {}): void {
        void params;
        void deps.showDanger("Cancel failed");
      }

      return {
        cancelFailed,
        commentsCopied,
        commentsKeptInTab,
        commentsNotSaved,
        copyFailed,
        preferencesNotSaved,
        preferencesUnavailable,
        reviewNotFinished,
        reviewUnavailable,
      };
    },
  },
);
