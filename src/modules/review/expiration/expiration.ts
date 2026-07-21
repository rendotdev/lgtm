import { build } from "../../../builder.ts";

export const { ReviewExpirationService, ReviewExpirationServiceBuilder } = build().service(
  "ReviewExpirationService",
  {
    config: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString() },
    deps: {
      now: function now() {
        return new Date();
      },
      onError: function onError(error: unknown) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      },
      onExpire: function onExpire() {},
      setTimer: function setTimer(callback: () => void, milliseconds: number) {
        return setTimeout(callback, milliseconds);
      },
    },
    build({ config, deps }) {
      function schedule(params: {}) {
        void params;
        const expiresAt = Date.parse(config.expiresAt);
        if (!Number.isFinite(expiresAt)) {
          throw new Error("Review expiresAt must be a valid date.");
        }
        const milliseconds = Math.max(0, expiresAt - deps.now().getTime());
        const timer = deps.setTimer(function expireReview() {
          void Promise.resolve(deps.onExpire()).catch(deps.onError);
        }, milliseconds);
        timer.unref?.();
        return timer;
      }

      return { schedule };
    },
  },
);
