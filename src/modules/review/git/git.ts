import { resolve } from "node:path";
import { build } from "../../../builder.ts";
import type {
  DiffReviewFileInput,
  GitReviewSource,
  ReviewCheckpointFile,
} from "../review/review.ts";
import { collectGitReviewFiles, collectGitReviewFilesSinceLast } from "../server/server.ts";
import { SSHGitRepositoryService } from "../ssh-git/ssh-git.ts";

export type GitReviewCollection = {
  files: DiffReviewFileInput[];
  checkpoint?: ReviewCheckpointFile[];
  source?: GitReviewSource;
};

export const { GitReviewService, GitReviewServiceBuilder } = build().service("GitReviewService", {
  config: {},
  deps: {
    collectLocal: collectGitReviewFiles,
    collectLocalSinceLast: collectGitReviewFilesSinceLast,
    collectRemote: SSHGitRepositoryService.collect,
  },
  build({ deps }) {
    async function collect(params: {
      cwd: string;
      remote?: string;
      remoteCwd?: string;
      sessionId?: string;
      signal?: AbortSignal;
      sinceLast?: boolean;
    }): Promise<GitReviewCollection> {
      if (params.remote) {
        if (!params.remoteCwd) {
          throw new Error("Remote Git reviews require --remote-cwd <absolute-path>.");
        }
        return await deps.collectRemote({
          localCwd: resolve(params.cwd),
          remote: params.remote,
          remoteCwd: params.remoteCwd,
          sessionId: params.sessionId,
          signal: params.signal,
          sinceLast: params.sinceLast,
        });
      }
      if (params.remoteCwd) {
        throw new Error("--remote-cwd requires --remote <destination>.");
      }
      if (params.sinceLast) {
        return await deps.collectLocalSinceLast(
          resolve(params.cwd),
          params.signal,
          params.sessionId,
        );
      }
      return { files: await deps.collectLocal(resolve(params.cwd), params.signal) };
    }

    return { collect };
  },
});
