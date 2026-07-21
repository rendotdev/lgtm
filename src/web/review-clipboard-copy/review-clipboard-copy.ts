import { build } from "../../builder.ts";

export const { ReviewClipboardCopyService, ReviewClipboardCopyServiceBuilder } = build().service(
  "ReviewClipboardCopyService",
  {
    config: {},
    deps: {
      async writeText(text: string) {
        await navigator.clipboard.writeText(text);
      },
    },
    build({ deps }) {
      async function copy(params: {
        text: string;
        onStart: () => void;
        onFinish: () => void;
      }): Promise<boolean> {
        params.onStart();
        try {
          await deps.writeText(params.text);
          return true;
        } catch {
          return false;
        } finally {
          params.onFinish();
        }
      }

      return { copy };
    },
  },
);
