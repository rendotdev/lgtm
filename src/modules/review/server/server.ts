import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "../../../builder.ts";
import { ReviewRetentionService, type ReviewManifest } from "../retention/retention.ts";
import {
  ReviewBuilderSingleton,
  ReviewFormatterSingleton,
  ReviewSourceSingleton,
  type DiffReviewFileInput,
  type OpenReviewInput,
  type ReviewJson,
  type ReviewOutcome,
  type ReviewPayload,
  type ReviewPointer,
} from "../review/review.ts";
import { ReviewGroupingService } from "../grouping/grouping.ts";
import { PreferencesStoreServiceBuilder } from "../../preferences/store/store.ts";
import { ReviewExpirationServiceBuilder } from "../expiration/expiration.ts";
import { ReviewGarbageCollectionServiceBuilder } from "../garbage-collection/garbage-collection.ts";
import {
  ReviewSinceLastStoreService,
  type SinceLastReviewCollection,
} from "../since-last-store/since-last-store.ts";
import { ReviewApiRouterServiceBuilder } from "../api/router/router.ts";
import { reviewManifestSchema, reviewPayloadSchema } from "../api/schemas/schemas.ts";

type CommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

type ReviewServerInfo = {
  url: string;
  pid: number;
};

type ReviewServerState = ReviewServerInfo & {
  appDir: string;
  reviewId: string;
  startedAt: string;
};

const activeReviewServersByPath = new Map<string, ReviewServerState>();
const cleanupReviewServersByPath = new Map<string, ReviewServerState>();
const abortCleanupByReviewPath = new Map<string, () => void>();
const finishWatchersByReviewPath = new Map<string, ReturnType<typeof setInterval>>();
let processCleanupRegistered = false;

export const { ReviewIdentifierSingleton, ReviewIdentifierSingletonBuilder } = build().singleton(
  "ReviewIdentifierSingleton",
  {
    build() {
      function sanitizePathSegment(params: { value: string }): string {
        return params.value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || randomUUID();
      }

      return { sanitizePathSegment };
    },
  },
);

export const { ReviewServerLifecycleService, ReviewServerLifecycleServiceBuilder } =
  build().service("ReviewServerLifecycleService", {
    config: {},
    deps: {
      activeReviewServersByPath,
      readReviewServerPid,
      readReviewServerState,
      stopReviewServerState,
    },
    build({ deps }) {
      async function stopForReview(params: {
        review: ReviewJson;
        reviewPath: string;
      }): Promise<boolean> {
        const appDir = params.review.appDir || resolve(params.reviewPath, "..");
        const knownState =
          deps.activeReviewServersByPath.get(params.reviewPath) ??
          (await deps.readReviewServerState(appDir));
        const pid = knownState?.pid ?? (await deps.readReviewServerPid(appDir));
        if (!pid) {
          return false;
        }
        const state: ReviewServerState = knownState ?? {
          pid,
          url: params.review.url ?? "",
          appDir,
          reviewId: params.review.reviewId,
          startedAt: params.review.updatedAt,
        };
        return await deps.stopReviewServerState(state, params.reviewPath);
      }

      return { stopForReview };
    },
  });

export const { WebRootService, WebRootServiceBuilder } = build().service("WebRootService", {
  config: {},
  deps: {
    modulePath: function modulePath() {
      return fileURLToPath(import.meta.url);
    },
    stat: async function statPath(path: string): Promise<unknown> {
      return await stat(path);
    },
  },
  build({ deps }) {
    async function resolveRoot(params: {}): Promise<string> {
      void params;
      const modulePath = deps.modulePath();
      const candidates = [
        process.env.LGTM_WEB_ROOT,
        resolve(modulePath, "..", "..", "..", "..", "..", "dist", "web"),
        resolve(modulePath, "..", "..", "dist", "web"),
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const candidate of candidates) {
        try {
          await deps.stat(join(candidate, "index.html"));
          return candidate;
        } catch {
          // Try the next build location.
        }
      }
      throw new Error("The LGTM frontend build is missing. Run vp build first.");
    }

    return { resolve: resolveRoot };
  },
});

export const { BuiltCliPathService, BuiltCliPathServiceBuilder } = build().service(
  "BuiltCliPathService",
  {
    config: { modulePath: fileURLToPath(import.meta.url) },
    deps: {
      stat: async function statPath(path: string): Promise<unknown> {
        return await stat(path);
      },
    },
    build({ config, deps }) {
      async function resolveExistingCliPath(cliPath: string): Promise<string> {
        try {
          await deps.stat(cliPath);
          return cliPath;
        } catch {
          throw new Error("LGTM CLI is not built. Run vp check and vp run package first.");
        }
      }

      async function resolvePath(params: {}): Promise<string> {
        void params;
        const sourceServerPath =
          sep + ["src", "modules", "review", "server", "server.ts"].join(sep);
        if (config.modulePath.endsWith(sourceServerPath)) {
          return resolveExistingCliPath(
            resolve(config.modulePath, "..", "..", "..", "..", "..", "dist", "cli.mjs"),
          );
        }
        const isExtension =
          config.modulePath.endsWith(sep + ["extensions", "index.js"].join(sep)) ||
          config.modulePath.endsWith(sep + ["extensions", "index.mjs"].join(sep));
        if (isExtension) {
          return resolveExistingCliPath(resolve(config.modulePath, "..", "..", "dist", "cli.mjs"));
        }
        if (config.modulePath.includes(sep + ["dist", "pi"].join(sep) + sep)) {
          return resolveExistingCliPath(resolve(config.modulePath, "..", "..", "cli.mjs"));
        }
        return config.modulePath;
      }

      return { resolve: resolvePath };
    },
  },
);

const ReviewGarbageCollection = ReviewGarbageCollectionServiceBuilder({
  config: {},
  deps: {
    retentionPolicy: ReviewRetentionService,
    stopServer: stopReviewServerForAppDir,
  },
});

export type OpenReviewOptions = {
  cwd: string;
  sessionId?: string;
  reviewUUID?: string;
  signal?: AbortSignal;
  cleanupOnExit?: boolean;
  detachedServer?: boolean;
  openBrowser?: boolean;
  replaceActiveReview?: boolean;
  trackAsActiveReview?: boolean;
  onUpdate?: (message: string) => void;
  onFinished?: (review: ReviewJson, formattedReview: string) => void | Promise<void>;
};

async function openReviewImplementation(
  input: OpenReviewInput,
  options: OpenReviewOptions,
): Promise<ReviewPointer> {
  const cwd = resolve(options.cwd);
  const sessionId = ReviewIdentifierSingleton.sanitizePathSegment({
    value: options.sessionId ?? `cli-${process.pid}`,
  });
  const reviewUUID = ReviewIdentifierSingleton.sanitizePathSegment({
    value: options.reviewUUID ?? randomUUID(),
  });
  const reviewId = `${sessionId}-${reviewUUID}`;
  const appDir = resolve(cwd, ".lgtm", reviewId);
  const reviewPath = join(appDir, "review.json");
  const generatedAt = new Date().toISOString();
  const manifest = ReviewRetentionService.createManifest({ reviewId, createdAt: generatedAt });
  const files = (input.files ?? []).map((file, index) =>
    ReviewSourceSingleton.build({ file, index }),
  );
  const groups = ReviewGroupingService.build({ files, groups: input.groups });

  if (options.replaceActiveReview === true) {
    options.onUpdate?.("Stopping any previous LGTM review server...");
    await stopActiveReviewServers(cwd);
  }
  await mkdir(appDir, { recursive: true });

  const review = ReviewBuilderSingleton.build({
    kind: input.kind,
    name: input.name,
    sessionId: sessionId,
    reviewUUID,
    reviewId,
    cwd,
    appDir,
    reviewPath,
    generatedAt,
    files,
    source: input.source,
    document: input.document,
  });
  const payload: ReviewPayload = {
    kind: input.kind,
    name: input.name,
    sessionId: sessionId,
    reviewUUID,
    reviewId,
    cwd,
    appDir,
    reviewPath,
    generatedAt,
    files,
    groups,
    checkpoint: input.checkpoint,
    source: input.source,
    document: input.document,
  };
  await writeReviewApp(appDir, payload, review, manifest);
  options.onUpdate?.("Starting LGTM review server...");
  const server = await startReviewServer(appDir, options.signal, options.detachedServer);
  const serverState: ReviewServerState = {
    ...server,
    appDir,
    reviewId,
    startedAt: new Date().toISOString(),
  };
  try {
    throwIfAborted(options.signal);
    await writeReviewServerState(serverState);
    const url = server.url;
    await writeFile(
      reviewPath,
      `${JSON.stringify({ ...review, url, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );

    if (options.trackAsActiveReview !== false) {
      activeReviewServersByPath.set(reviewPath, serverState);
    }
    const signal = options.signal;
    const shouldTrackAbort = signal && options.trackAsActiveReview !== false;
    if (shouldTrackAbort) {
      function abort() {
        void stopReviewImplementation(cwd, reviewPath);
      }
      signal.addEventListener("abort", abort, { once: true });
      abortCleanupByReviewPath.set(reviewPath, () => signal.removeEventListener("abort", abort));
      if (signal.aborted) {
        abort();
      }
    }
    if (options.cleanupOnExit) {
      cleanupReviewServersByPath.set(reviewPath, serverState);
      registerProcessCleanup();
    }

    const pointer: ReviewPointer = {
      name: input.name,
      sessionId: sessionId,
      reviewUUID,
      reviewId,
      appDir,
      url,
      reviewPath,
    };
    if (options.onFinished) {
      startReviewFinishWatcher(cwd, pointer, options.onFinished);
    }
    if (options.openBrowser !== false) {
      openInDefaultBrowser(url);
    }
    return pointer;
  } catch (error) {
    if (options.trackAsActiveReview !== false) {
      abortCleanupByReviewPath.get(reviewPath)?.();
      abortCleanupByReviewPath.delete(reviewPath);
      activeReviewServersByPath.delete(reviewPath);
    }
    cleanupReviewServersByPath.delete(reviewPath);
    await stopReviewServerProcess(serverState).catch(() => false);
    throw error;
  }
}

async function collectGitReviewFilesImplementation(
  cwd: string,
  signal?: AbortSignal,
  options: { allowEmpty?: boolean } = {},
): Promise<DiffReviewFileInput[]> {
  const rootResult = await runCommand("git", ["rev-parse", "--show-toplevel"], cwd, signal, 10_000);
  if (rootResult.code !== 0) {
    throw new Error(
      `Unable to open Git review from ${cwd}.\n${rootResult.stderr || rootResult.stdout}`,
    );
  }
  const root = rootResult.stdout.trim();
  const headResult = await runCommand(
    "git",
    ["rev-parse", "--verify", "HEAD"],
    root,
    signal,
    10_000,
  );
  const hasHead = headResult.code === 0;
  const changedPaths: Array<{ oldPath?: string; newPath?: string }> = [];

  if (hasHead) {
    const diffResult = await runCommand(
      "git",
      ["diff", "--name-status", "-z", "--find-renames", "HEAD", "--"],
      root,
      signal,
      30_000,
    );
    if (diffResult.code !== 0) {
      throw new Error(`git diff failed.\n${diffResult.stderr || diffResult.stdout}`);
    }
    changedPaths.push(...parseGitNameStatus(diffResult.stdout));
  } else {
    const trackedResult = await runCommand(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      root,
      signal,
      30_000,
    );
    if (trackedResult.code !== 0) {
      throw new Error(`git ls-files failed.\n${trackedResult.stderr || trackedResult.stdout}`);
    }
    for (const path of trackedResult.stdout.split("\0").filter(Boolean)) {
      changedPaths.push({ newPath: path });
    }
  }

  const untrackedResult = await runCommand(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    root,
    signal,
    30_000,
  );
  if (untrackedResult.code !== 0) {
    throw new Error(`git ls-files failed.\n${untrackedResult.stderr || untrackedResult.stdout}`);
  }
  for (const path of untrackedResult.stdout.split("\0").filter(Boolean)) {
    changedPaths.push({ newPath: path });
  }

  const deduplicated = new Map<string, { oldPath?: string; newPath?: string }>();
  for (const change of changedPaths) {
    deduplicated.set(change.newPath ?? change.oldPath ?? randomUUID(), change);
  }

  const files: DiffReviewFileInput[] = [];
  for (const change of deduplicated.values()) {
    const oldContent =
      hasHead && change.oldPath ? await readGitFile(root, change.oldPath, signal) : "";
    const newContent = change.newPath ? await readWorkingTreeFile(root, change.newPath) : "";
    const isBinaryFile = oldContent.includes("\0") || newContent.includes("\0");
    if (isBinaryFile) {
      continue;
    }
    files.push({
      location: change.newPath ?? change.oldPath ?? "unknown",
      oldContent,
      newContent,
    });
  }

  const hasNoReviewableFiles = files.length === 0 && options.allowEmpty !== true;
  if (hasNoReviewableFiles) {
    throw new Error("No text changes were found to review.");
  }
  return files;
}

async function collectGitReviewFilesSinceLastImplementation(
  cwd: string,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<SinceLastReviewCollection> {
  const rootResult = await runCommand("git", ["rev-parse", "--show-toplevel"], cwd, signal, 10_000);
  if (rootResult.code !== 0) {
    throw new Error(
      `Unable to open Git review from ${cwd}.\n${rootResult.stderr || rootResult.stdout}`,
    );
  }
  const root = rootResult.stdout.trim();
  const currentFiles = await collectGitReviewFilesImplementation(cwd, signal, { allowEmpty: true });
  const collection = await ReviewSinceLastStoreService.collect({
    root,
    reviewRoots: [resolve(root, ".lgtm"), resolve(cwd, ".lgtm")],
    currentFiles,
    sessionId,
  });
  if (collection.files.length === 0) {
    throw new Error("No text changes were found since the last LGTM review.");
  }
  return collection;
}

function parseGitNameStatus(output: string): Array<{ oldPath?: string; newPath?: string }> {
  const fields = output.split("\0").filter(Boolean);
  const changes: Array<{ oldPath?: string; newPath?: string }> = [];
  for (let index = 0; index < fields.length; index += 1) {
    let status = "";
    let path = "";
    const tab = fields[index].indexOf("\t");
    if (tab >= 0) {
      status = fields[index].slice(0, tab);
      path = fields[index].slice(tab + 1);
    } else {
      status = fields[index];
      path = fields[index + 1] ?? "";
      index += 1;
    }

    const kind = status.charAt(0);
    const isRenameOrCopy = kind === "R" || kind === "C";
    if (isRenameOrCopy) {
      const newPath = fields[index + 1] ?? "";
      index += 1;
      changes.push({ oldPath: path, newPath });
    } else if (kind === "A") {
      changes.push({ newPath: path });
    } else if (kind === "D") {
      changes.push({ oldPath: path });
    } else {
      changes.push({ oldPath: path, newPath: path });
    }
  }
  return changes.filter((change) => change.oldPath || change.newPath);
}

async function readGitFile(root: string, path: string, signal?: AbortSignal): Promise<string> {
  const result = await runCommand("git", ["show", `HEAD:${path}`], root, signal, 30_000);
  return result.code === 0 ? result.stdout : "";
}

async function readWorkingTreeFile(root: string, path: string): Promise<string> {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch {
    return "";
  }
}

async function readReviewIfExists(reviewPath: string): Promise<ReviewJson | undefined> {
  try {
    return JSON.parse(await readFile(reviewPath, "utf8")) as ReviewJson;
  } catch {
    return undefined;
  }
}

async function writeReviewApp(
  appDir: string,
  payload: ReviewPayload,
  review: ReviewJson,
  manifest: ReviewManifest,
) {
  await mkdir(appDir, { recursive: true });
  await Promise.all([
    writeFile(join(appDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(join(appDir, "payload.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    writeFile(join(appDir, "review.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8"),
  ]);
}

async function startReviewServer(
  appDir: string,
  signal?: AbortSignal,
  detached = true,
): Promise<ReviewServerInfo> {
  const cliPath = await BuiltCliPathService.resolve({});
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [cliPath, "serve", "--app-dir", appDir], {
      cwd: resolve(appDir, "..", ".."),
      env: { ...process.env },
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      cleanup();
      if (child.pid) {
        killReviewServerPid(child.pid, "SIGTERM");
      } else {
        child.kill();
      }
      rejectPromise(new Error("Timed out while starting LGTM review server."));
    }, 20_000);

    let stderr = "";
    let settled = false;

    function abort() {
      cleanup();
      if (child.pid) {
        killReviewServerPid(child.pid, "SIGTERM");
      } else {
        child.kill();
      }
      rejectPromise(new Error("Cancelled while starting LGTM review server."));
    }

    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    }

    async function finish(url: string) {
      if (settled) {
        return;
      }
      const pid = child.pid;
      if (!pid) {
        settled = true;
        cleanup();
        rejectPromise(new Error("LGTM review server started without a process ID."));
        return;
      }
      settled = true;
      cleanup();
      if (detached) {
        (child.stdout as unknown as { unref?: () => void } | undefined)?.unref?.();
        (child.stderr as unknown as { unref?: () => void } | undefined)?.unref?.();
        child.unref();
      }
      await writeFile(join(appDir, "server.pid"), `${pid}\n`, "utf8");
      resolvePromise({ url, pid });
    }

    function onStdout(chunk: Buffer) {
      const text = chunk.toString("utf8");
      const match = text.match(/LGTM_REVIEW_URL=(\S+)/);
      if (match?.[1]) {
        void finish(match[1]);
      }
    }

    function onStderr(chunk: Buffer) {
      stderr += chunk.toString("utf8");
    }

    function onExit(code: number | null) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(
        new Error(`LGTM review server exited with code ${code ?? "unknown"}.\n${stderr}`),
      );
    }

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("exit", onExit);
  });
}

async function serveReviewAppImplementation(appDirInput: string): Promise<void> {
  const appDir = resolve(appDirInput);
  const payloadPath = join(appDir, "payload.json");
  const reviewPath = join(appDir, "review.json");
  const payload = reviewPayloadSchema.parse(await readJsonFile<ReviewPayload>(payloadPath));
  const manifest = reviewManifestSchema.parse(
    await readJsonFile<ReviewManifest>(join(appDir, "manifest.json")),
  );
  const PreferencesStore = PreferencesStoreServiceBuilder({
    config: { cwd: payload.cwd },
    deps: {},
  });
  const webRoot = await WebRootService.resolve({});
  let server: ReturnType<typeof createServer>;
  const ApiRouter = ReviewApiRouterServiceBuilder({
    config: { payloadPath, reviewPath },
    deps: {
      preferencesStore: PreferencesStore,
      closeServer: function closeServer() {
        server.close(function exitServer() {
          process.exit(0);
        });
        const forceExit = setTimeout(function forceExitServer() {
          process.exit(0);
        }, 1_000);
        forceExit.unref();
      },
    },
  });

  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (await ApiRouter.handle({ request, response, url })) {
        return;
      }

      if (request.method === "GET") {
        return await sendStaticFile(response, webRoot, url.pathname);
      }

      ApiRouter.sendError({ response, status: 404, error: "Not found." });
    } catch (error) {
      ApiRouter.sendError({ response, status: 400, error });
    }
  });

  async function expireReview() {
    await rm(appDir, { force: true, recursive: true });
    server.close(function exitExpiredReview() {
      process.exit(0);
    });
    server.closeAllConnections();
    const forceExit = setTimeout(() => process.exit(0), 1_000);
    forceExit.unref();
  }

  const ExpirationScheduler = ReviewExpirationServiceBuilder({
    config: { expiresAt: manifest.expiresAt },
    deps: {
      now: function now() {
        return new Date();
      },
      onError: function reportExpirationError(error) {
        process.stderr.write(
          `LGTM review expiration failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      },
      onExpire: expireReview,
      setTimer: setTimeout,
    },
  });
  ExpirationScheduler.schedule({});

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const isInvalidAddress = !address || typeof address === "string";
      if (isInvalidAddress) {
        rejectPromise(new Error("LGTM review server did not receive a TCP port."));
        return;
      }
      console.log(`LGTM_REVIEW_URL=http://localhost:${address.port}/`);
      resolvePromise();
    });
  });

  async function cleanExpiredReviews() {
    try {
      const result = await ReviewGarbageCollection.cleanExpired({
        root: join(payload.cwd, ".lgtm"),
        excludeAppDir: appDir,
      });
      if (result.failures.length === 0) {
        return;
      }
      process.stderr.write(
        `LGTM cleanup could not fully remove ${result.failures.length} expired review item(s).\n`,
      );
    } catch (error) {
      process.stderr.write(
        `LGTM cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  void cleanExpiredReviews();
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

async function sendStaticFile(response: ServerResponse, webRoot: string, pathname: string) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(webRoot, relativePath);
  const isOutsideWebRoot = filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`);
  if (isOutsideWebRoot) {
    return sendJson(response, 404, { error: "Not found." });
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForPath(filePath),
      "content-length": body.length,
      "cache-control":
        relativePath === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

function contentTypeForPath(path: string) {
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  return contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function writeReviewServerState(state: ReviewServerState) {
  await writeFile(join(state.appDir, "server.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readReviewServerState(appDir: string): Promise<ReviewServerState | undefined> {
  try {
    const state = JSON.parse(
      await readFile(join(appDir, "server.json"), "utf8"),
    ) as ReviewServerState;
    const isValidState =
      Number.isInteger(state.pid) &&
      typeof state.appDir === "string" &&
      resolve(state.appDir) === resolve(appDir);
    if (isValidState) {
      return state;
    }
  } catch {
    // No server state.
  }
  return undefined;
}

async function stopReviewServerForAppDir(appDir: string) {
  const state = await readReviewServerState(appDir);
  if (state) {
    return await stopReviewServerProcess(state);
  }
  const pid = await readReviewServerPid(appDir);
  if (!pid) {
    return false;
  }
  return await stopReviewServerProcess({
    pid,
    url: "",
    appDir,
    reviewId: resolve(appDir).split(sep).at(-1) ?? "unknown",
    startedAt: new Date(0).toISOString(),
  });
}

async function stopActiveReviewServers(cwd: string) {
  const reviewRoot = `${join(resolve(cwd), ".lgtm")}${sep}`;
  const states = [...activeReviewServersByPath.values()].filter((state) =>
    state.appDir.startsWith(reviewRoot),
  );
  const stopped = await Promise.all(states.map((state) => stopReviewServerState(state)));
  return stopped.some(Boolean);
}

function startReviewFinishWatcher(
  cwd: string,
  pointer: ReviewPointer,
  onFinished: NonNullable<OpenReviewOptions["onFinished"]>,
) {
  stopReviewFinishWatcher(pointer.reviewPath);

  const interval = setInterval(async () => {
    let review: ReviewJson;
    try {
      review = JSON.parse(await readFile(pointer.reviewPath, "utf8")) as ReviewJson;
    } catch {
      return;
    }

    if (review.status === "open") {
      return;
    }
    stopReviewFinishWatcher(pointer.reviewPath);
    await ReviewServerLifecycleService.stopForReview({
      review,
      reviewPath: pointer.reviewPath,
    }).catch(() => false);
    await onFinished(review, formatReviewForModelImplementation(review, pointer.reviewPath));
  }, 1_000);

  (interval as unknown as { unref?: () => void }).unref?.();
  finishWatchersByReviewPath.set(pointer.reviewPath, interval);
}

function stopReviewFinishWatcher(reviewPath: string) {
  const interval = finishWatchersByReviewPath.get(reviewPath);
  if (!interval) {
    return;
  }
  clearInterval(interval);
  finishWatchersByReviewPath.delete(reviewPath);
}

function stopReviewFinishWatchers(cwd: string) {
  const reviewRoot = `${join(resolve(cwd), ".lgtm")}${sep}`;
  for (const reviewPath of finishWatchersByReviewPath.keys()) {
    if (reviewPath.startsWith(reviewRoot)) {
      stopReviewFinishWatcher(reviewPath);
    }
  }
}

async function stopReviewServerState(
  state: ReviewServerState,
  reviewPath = join(state.appDir, "review.json"),
) {
  abortCleanupByReviewPath.get(reviewPath)?.();
  abortCleanupByReviewPath.delete(reviewPath);
  const stopped = await stopReviewServerProcess(state);
  cleanupReviewServersByPath.delete(reviewPath);
  activeReviewServersByPath.delete(reviewPath);
  if (stopped) {
    stopReviewFinishWatcher(reviewPath);
  }
  return stopped;
}

async function stopReviewImplementation(cwd: string, reviewPath: string) {
  const review = await readReviewIfExists(reviewPath);
  if (!review) {
    return false;
  }
  stopReviewFinishWatcher(reviewPath);
  return await ReviewServerLifecycleService.stopForReview({ review, reviewPath });
}

async function readReviewServerPid(appDir: string) {
  try {
    return parseServerPid(await readFile(join(appDir, "server.pid"), "utf8"));
  } catch {
    return undefined;
  }
}

function parseServerPid(value: string) {
  const pid = Number.parseInt(value.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function stopReviewServerProcess(state: ReviewServerState) {
  if (!(await isLikelyReviewServerProcess(state.pid))) {
    return false;
  }
  killReviewServerPid(state.pid, "SIGTERM");
  if (await waitForProcessExit(state.pid, 1_500)) {
    return true;
  }
  killReviewServerPid(state.pid, "SIGKILL");
  return await waitForProcessExit(state.pid, 1_000);
}

async function isLikelyReviewServerProcess(pid: number) {
  if (!isProcessRunning(pid)) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }

  try {
    const result = await runCommand(
      "ps",
      ["-p", String(pid), "-o", "command="],
      process.cwd(),
      undefined,
      5_000,
    );
    const command = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return (
      result.code === 0 &&
      command.includes("node") &&
      command.includes("serve") &&
      command.includes("--app-dir")
    );
  } catch {
    return false;
  }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killReviewServerPid(pid: number, signal: NodeJS.Signals) {
  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already stopped.
    }
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return !isProcessRunning(pid);
}

function registerProcessCleanup() {
  if (processCleanupRegistered) {
    return;
  }
  processCleanupRegistered = true;
  process.once("exit", () => {
    for (const state of cleanupReviewServersByPath.values()) {
      killReviewServerPid(state.pid, "SIGTERM");
    }
  });
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    function abort() {
      child.kill();
      rejectPromise(new Error(`${command} cancelled.`));
    }

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolvePromise({ stdout, stderr, code });
    });
  });
}

function openInDefaultBrowser(target: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export type FinishReviewResult =
  | { found: false }
  | {
      found: true;
      reviewPath: string;
      review: ReviewJson;
      stoppedServer: boolean;
      formattedReview: string;
    };

export type WaitForReviewOptions = {
  cwd: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  stopServer?: boolean;
};

export type CompletedReview = {
  reviewPath: string;
  review: ReviewJson & { status: ReviewOutcome };
  stoppedServer: boolean;
  formattedReview: string;
};

/**
 * Wait for the browser checkpoint to reach a terminal decision. This is the
 * lifecycle used by synchronous agent protocols such as MCP: the tool call
 * remains pending until the human approves, requests changes, or cancels.
 */
async function waitForReviewImplementation(
  pointer: ReviewPointer,
  options: WaitForReviewOptions,
): Promise<CompletedReview> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const isInvalidPollInterval = !Number.isFinite(pollIntervalMs) || pollIntervalMs < 10;
  if (isInvalidPollInterval) {
    throw new Error("pollIntervalMs must be at least 10 milliseconds.");
  }

  try {
    while (true) {
      throwIfAborted(options.signal);
      const review = await readReviewIfExists(pointer.reviewPath);
      const isReviewComplete = review && review.status !== "open";
      if (isReviewComplete) {
        stopReviewFinishWatcher(pointer.reviewPath);
        const stoppedServer =
          options.stopServer === false
            ? false
            : await ReviewServerLifecycleService.stopForReview({
                review,
                reviewPath: pointer.reviewPath,
              });
        return {
          reviewPath: pointer.reviewPath,
          review: review as ReviewJson & { status: ReviewOutcome },
          stoppedServer,
          formattedReview: formatReviewForModelImplementation(review, pointer.reviewPath),
        };
      }
      await abortableDelay(pollIntervalMs, options.signal);
    }
  } catch (error) {
    const shouldStopAbortedReview = options.signal?.aborted && options.stopServer !== false;
    if (shouldStopAbortedReview) {
      await stopReviewImplementation(options.cwd, pointer.reviewPath).catch(() => false);
    }
    throw error;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The review was canceled.", "AbortError");
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(finish, milliseconds);
    function abort() {
      cleanup();
      rejectPromise(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("The review was canceled.", "AbortError"),
      );
    }
    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    function finish() {
      cleanup();
      resolvePromise();
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

async function finishReviewImplementation(
  cwd: string,
  reviewPathInput: string,
): Promise<FinishReviewResult> {
  const resolvedCwd = resolve(cwd);
  const reviewPath = resolve(resolvedCwd, reviewPathInput);
  const review = await readReviewIfExists(reviewPath);
  if (!review) {
    return { found: false };
  }
  if (review.status === "open") {
    return {
      found: true,
      reviewPath,
      review,
      stoppedServer: false,
      formattedReview: formatReviewForModelImplementation(review, reviewPath),
    };
  }
  stopReviewFinishWatcher(reviewPath);
  const stoppedServer = await ReviewServerLifecycleService.stopForReview({ review, reviewPath });
  return {
    found: true,
    reviewPath,
    review,
    stoppedServer,
    formattedReview: formatReviewForModelImplementation(review, reviewPath),
  };
}

async function stopReviewsImplementation(cwd: string) {
  const resolvedCwd = resolve(cwd);
  stopReviewFinishWatchers(resolvedCwd);
  return await stopActiveReviewServers(resolvedCwd);
}

function formatReviewForModelImplementation(review: ReviewJson, reviewPath: string): string {
  return ReviewFormatterSingleton.format({ review, reviewPath });
}

export const { ReviewServerSingleton, ReviewServerSingletonBuilder } = build().singleton(
  "ReviewServerSingleton",
  {
    build() {
      return {
        collectGitReviewFiles: collectGitReviewFilesImplementation,
        collectGitReviewFilesSinceLast: collectGitReviewFilesSinceLastImplementation,
        finishReview: finishReviewImplementation,
        formatReviewForModel: formatReviewForModelImplementation,
        openReview: openReviewImplementation,
        serveReviewApp: serveReviewAppImplementation,
        stopReview: stopReviewImplementation,
        stopReviews: stopReviewsImplementation,
        waitForReview: waitForReviewImplementation,
      };
    },
  },
);

export const {
  collectGitReviewFiles,
  collectGitReviewFilesSinceLast,
  finishReview,
  formatReviewForModel,
  openReview,
  serveReviewApp,
  stopReview,
  stopReviews,
  waitForReview,
} = ReviewServerSingleton;
