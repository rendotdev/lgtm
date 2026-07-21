import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { build } from "../../../builder.ts";
import type { DiffReviewFileInput, GitReviewSource } from "../review/review.ts";
import { ReviewSinceLastStoreService } from "../since-last-store/since-last-store.ts";

type SSHProcessResult = {
  stdout: Buffer;
  stderr: string;
  code: number | null;
};

type SSHControlConnection = {
  destination: string;
  socketDirectory: string;
  socketPath: string;
};

export type RemoteGitReviewCollection = {
  files: DiffReviewFileInput[];
  checkpoint?: Array<{ location: string; content: string }>;
  source: GitReviewSource;
};

export const { SSHCommandService, SSHCommandServiceBuilder } = build().service(
  "SSHCommandService",
  {
    config: { maximumCommandLength: 65_536 },
    deps: {},
    build({ config }) {
      function quote(params: { value: string }): string {
        if (params.value.includes("\0")) {
          throw new Error("SSH command arguments cannot contain NUL bytes.");
        }
        return `'${params.value.replaceAll("'", `'"'"'`)}'`;
      }

      function executable(params: { marker: string; executable: string; args: string[] }): string {
        const command = [params.executable, ...params.args]
          .map((value) => quote({ value }))
          .join(" ");
        return validate({
          command: `printf '%s\\n' ${quote({ value: params.marker })}; exec ${command}`,
        });
      }

      function hasHead(params: { marker: string; root: string }): string {
        const root = quote({ value: params.root });
        const marker = quote({ value: params.marker });
        return validate({
          command: `if git -C ${root} rev-parse --verify HEAD >/dev/null 2>&1; then printf '%s\\ntrue' ${marker}; else printf '%s\\nfalse' ${marker}; fi`,
        });
      }

      function worktreeFile(params: { marker: string; path: string }): string {
        const path = quote({ value: params.path });
        const marker = quote({ value: params.marker });
        return validate({
          command: `printf '%s\\n' ${marker}; if [ -L ${path} ]; then readlink ${path}; else cat ${path}; fi`,
        });
      }

      function validate(params: { command: string }): string {
        if (Buffer.byteLength(params.command) > config.maximumCommandLength) {
          throw new Error(
            `SSH command exceeds the ${config.maximumCommandLength}-byte safety limit.`,
          );
        }
        return params.command;
      }

      return { executable, hasHead, quote, worktreeFile };
    },
  },
);

export const { SSHProcessService, SSHProcessServiceBuilder } = build().service(
  "SSHProcessService",
  {
    config: { maximumOutputBytes: 100 * 1024 * 1024, timeoutMilliseconds: 30_000 },
    deps: { spawn },
    build({ config, deps }) {
      async function run(params: {
        args: string[];
        signal?: AbortSignal;
        maximumOutputBytes?: number;
      }): Promise<SSHProcessResult> {
        return await new Promise((resolvePromise, rejectPromise) => {
          const child = deps.spawn("ssh", params.args, {
            stdio: ["ignore", "pipe", "pipe"],
          });
          const stdout: Buffer[] = [];
          let stdoutBytes = 0;
          let stderr = "";
          let settled = false;
          const maximumOutputBytes = params.maximumOutputBytes ?? config.maximumOutputBytes;
          const timeout = setTimeout(() => {
            child.kill();
            finishWithError(new Error(`ssh timed out after ${config.timeoutMilliseconds}ms.`));
          }, config.timeoutMilliseconds);

          function cleanup() {
            clearTimeout(timeout);
            params.signal?.removeEventListener("abort", abort);
          }

          function finishWithError(error: Error) {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            rejectPromise(error);
          }

          function abort() {
            child.kill();
            finishWithError(
              params.signal?.reason instanceof Error
                ? params.signal.reason
                : new DOMException("SSH command canceled.", "AbortError"),
            );
          }

          params.signal?.addEventListener("abort", abort, { once: true });
          if (params.signal?.aborted) {
            abort();
            return;
          }

          child.stdout?.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.length;
            if (stdoutBytes > maximumOutputBytes) {
              child.kill();
              finishWithError(
                new Error(`SSH response exceeds the ${maximumOutputBytes}-byte safety limit.`),
              );
              return;
            }
            stdout.push(chunk);
          });
          child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
          child.once("error", finishWithError);
          child.once("exit", (code) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            resolvePromise({ stdout: Buffer.concat(stdout), stderr, code });
          });
        });
      }

      return { run };
    },
  },
);

export const { SSHControlConnectionService, SSHControlConnectionServiceBuilder } = build().service(
  "SSHControlConnectionService",
  {
    config: {},
    deps: {
      makeTemporaryDirectory: async function makeTemporaryDirectory(
        prefix: string,
      ): Promise<string> {
        return await mkdtemp(prefix);
      },
      removeDirectory: async function removeDirectory(path: string) {
        await rm(path, { force: true, recursive: true });
      },
      processRunner: SSHProcessService,
    },
    build({ deps }) {
      async function open(params: {
        destination: string;
        signal?: AbortSignal;
      }): Promise<SSHControlConnection> {
        validateDestination({ destination: params.destination });
        const socketDirectory = await deps.makeTemporaryDirectory(join(tmpdir(), "lgtm-ssh-"));
        const connection = {
          destination: params.destination,
          socketDirectory,
          socketPath: join(socketDirectory, "control"),
        };
        try {
          const result = await deps.processRunner.run({
            args: [
              "-M",
              "-S",
              connection.socketPath,
              "-o",
              "ControlPersist=no",
              "-fN",
              "--",
              params.destination,
            ],
            signal: params.signal,
          });
          assertSuccess({ result, action: `connect to ${params.destination}` });
          return connection;
        } catch (error) {
          await deps.removeDirectory(socketDirectory).catch(() => undefined);
          throw error;
        }
      }

      async function execute(params: {
        connection: SSHControlConnection;
        command: string;
        marker: string;
        signal?: AbortSignal;
        maximumOutputBytes?: number;
      }): Promise<Buffer> {
        const result = await deps.processRunner.run({
          args: [
            "-S",
            params.connection.socketPath,
            "-T",
            "--",
            params.connection.destination,
            params.command,
          ],
          signal: params.signal,
          maximumOutputBytes: params.maximumOutputBytes,
        });
        assertSuccess({ result, action: `read from ${params.connection.destination}` });
        const frame = Buffer.from(`${params.marker}\n`);
        const frameIndex = result.stdout.indexOf(frame);
        if (frameIndex < 0) {
          throw new Error("SSH response did not contain the expected lgtm frame marker.");
        }
        return result.stdout.subarray(frameIndex + frame.length);
      }

      async function close(params: { connection: SSHControlConnection }): Promise<void> {
        await deps.processRunner
          .run({
            args: [
              "-S",
              params.connection.socketPath,
              "-O",
              "exit",
              "--",
              params.connection.destination,
            ],
          })
          .catch(() => undefined);
        await deps.removeDirectory(params.connection.socketDirectory).catch(() => undefined);
      }

      function validateDestination(params: { destination: string }) {
        const isInvalidDestination = !params.destination || params.destination.includes("\0");
        if (isInvalidDestination) {
          throw new Error("--remote requires a valid SSH destination.");
        }
      }

      function assertSuccess(params: { result: SSHProcessResult; action: string }) {
        if (params.result.code === 0) {
          return;
        }
        const details = params.result.stderr.trim();
        const prefix =
          params.result.code === 255 ? "SSH connection failed" : "Remote command failed";
        throw new Error(
          `${prefix} while trying to ${params.action}.${details ? `\n${details}` : ""}`,
        );
      }

      return { close, execute, open };
    },
  },
);

export const { SSHGitRepositoryService, SSHGitRepositoryServiceBuilder } = build().service(
  "SSHGitRepositoryService",
  {
    config: { fileConcurrency: 6, maximumFileBytes: 50 * 1024 * 1024 },
    deps: {
      commandEncoder: SSHCommandService,
      connection: SSHControlConnectionService,
      randomUUID: function createRandomUUID(): string {
        return randomUUID();
      },
      processRunner: SSHProcessService,
    },
    build({ config, deps }) {
      async function collect(params: {
        localCwd: string;
        remote: string;
        remoteCwd: string;
        sessionId?: string;
        signal?: AbortSignal;
        sinceLast?: boolean;
      }): Promise<RemoteGitReviewCollection> {
        if (!isAbsolute(params.remoteCwd)) {
          throw new Error("--remote-cwd and remote worktree paths must be absolute.");
        }
        const endpoint = await describeEndpoint({
          destination: params.remote,
          signal: params.signal,
        });
        const connection = await deps.connection.open({
          destination: params.remote,
          signal: params.signal,
        });
        try {
          const root = (
            await runExecutable({
              connection,
              executable: "git",
              args: ["-C", params.remoteCwd, "rev-parse", "--show-toplevel"],
              signal: params.signal,
            })
          )
            .toString("utf8")
            .trim();
          if (!isAbsolute(root)) {
            throw new Error(`Remote Git root is not absolute: ${root || "(empty)"}.`);
          }
          const source: GitReviewSource = {
            kind: "git",
            transport: "ssh",
            key: `ssh://${endpoint.user}@${endpoint.hostname}:${endpoint.port}${root}`,
            label: `${params.remote}:${root}`,
          };
          const files = await collectFiles({ connection, root, signal: params.signal });
          if (!params.sinceLast) {
            assertFiles({ files, message: "No text changes were found to review." });
            return { files, source };
          }
          const collection = await ReviewSinceLastStoreService.collect({
            root,
            reviewRoots: [resolve(params.localCwd, ".lgtm")],
            currentFiles: files,
            sessionId: params.sessionId,
            sourceKey: source.key,
            readCurrentContent: async (location) =>
              (
                await readWorktreeFile({
                  connection,
                  root,
                  location,
                  signal: params.signal,
                  allowMissing: true,
                })
              ).toString("utf8"),
          });
          assertFiles({
            files: collection.files,
            message: "No text changes were found since the last lgtm review.",
          });
          return {
            files: collection.files,
            checkpoint: collection.checkpoint,
            source,
          };
        } finally {
          await deps.connection.close({ connection });
        }
      }

      async function describeEndpoint(params: { destination: string; signal?: AbortSignal }) {
        const result = await deps.processRunner.run({
          args: ["-G", "--", params.destination],
          signal: params.signal,
        });
        if (result.code !== 0) {
          throw new Error(
            `Unable to resolve SSH destination ${params.destination}.${result.stderr ? `\n${result.stderr.trim()}` : ""}`,
          );
        }
        const settings = new Map<string, string>();
        for (const line of result.stdout.toString("utf8").split("\n")) {
          const separator = line.indexOf(" ");
          if (separator > 0) {
            settings.set(line.slice(0, separator), line.slice(separator + 1).trim());
          }
        }
        const hostname = settings.get("hostname");
        const user = settings.get("user");
        const port = settings.get("port") ?? "22";
        const isEndpointIncomplete = !hostname || !user;
        if (isEndpointIncomplete) {
          throw new Error(`ssh -G did not resolve a hostname and user for ${params.destination}.`);
        }
        const formattedHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
        return { hostname: formattedHostname, user, port };
      }

      async function collectFiles(params: {
        connection: SSHControlConnection;
        root: string;
        signal?: AbortSignal;
      }): Promise<DiffReviewFileInput[]> {
        const hasHead =
          (
            await runCommand({
              connection: params.connection,
              command: deps.commandEncoder.hasHead({
                marker: nextMarker(),
                root: params.root,
              }),
              signal: params.signal,
            })
          )
            .toString("utf8")
            .trim() === "true";
        const changes: Array<{ oldPath?: string; newPath?: string }> = [];
        if (hasHead) {
          const status = await runExecutable({
            connection: params.connection,
            executable: "git",
            args: [
              "-C",
              params.root,
              "diff",
              "--name-status",
              "-z",
              "--find-renames",
              "HEAD",
              "--",
            ],
            signal: params.signal,
          });
          changes.push(...parseNameStatus({ output: status.toString("utf8") }));
        } else {
          const paths = await runExecutable({
            connection: params.connection,
            executable: "git",
            args: [
              "-C",
              params.root,
              "ls-files",
              "--cached",
              "--others",
              "--exclude-standard",
              "-z",
            ],
            signal: params.signal,
          });
          for (const path of paths.toString("utf8").split("\0").filter(Boolean)) {
            changes.push({ newPath: path });
          }
        }
        const untracked = await runExecutable({
          connection: params.connection,
          executable: "git",
          args: ["-C", params.root, "ls-files", "--others", "--exclude-standard", "-z"],
          signal: params.signal,
        });
        for (const path of untracked.toString("utf8").split("\0").filter(Boolean)) {
          changes.push({ newPath: path });
        }
        const deduplicated = new Map<string, { oldPath?: string; newPath?: string }>();
        for (const change of changes) {
          const key = change.newPath ?? change.oldPath;
          if (key) {
            deduplicated.set(key, change);
          }
        }
        const pending = [...deduplicated.values()];
        const files: DiffReviewFileInput[] = [];
        for (let index = 0; index < pending.length; index += config.fileConcurrency) {
          const batch = await Promise.all(
            pending.slice(index, index + config.fileConcurrency).map(async (change) => {
              const [oldContent, newContent] = await Promise.all([
                hasHead && change.oldPath
                  ? readHeadFile({
                      connection: params.connection,
                      root: params.root,
                      location: change.oldPath,
                      signal: params.signal,
                    })
                  : Promise.resolve(Buffer.alloc(0)),
                change.newPath
                  ? readWorktreeFile({
                      connection: params.connection,
                      root: params.root,
                      location: change.newPath,
                      signal: params.signal,
                    })
                  : Promise.resolve(Buffer.alloc(0)),
              ]);
              const isBinaryFile = oldContent.includes(0) || newContent.includes(0);
              if (isBinaryFile) {
                return undefined;
              }
              return {
                location: change.newPath ?? change.oldPath ?? "unknown",
                oldContent: oldContent.toString("utf8"),
                newContent: newContent.toString("utf8"),
              };
            }),
          );
          files.push(...batch.filter((file): file is DiffReviewFileInput => Boolean(file)));
        }
        return files;
      }

      async function readHeadFile(params: {
        connection: SSHControlConnection;
        root: string;
        location: string;
        signal?: AbortSignal;
      }): Promise<Buffer> {
        try {
          return await runExecutable({
            connection: params.connection,
            executable: "git",
            args: ["-C", params.root, "show", `HEAD:${params.location}`],
            signal: params.signal,
            maximumOutputBytes: config.maximumFileBytes,
          });
        } catch {
          return Buffer.alloc(0);
        }
      }

      async function readWorktreeFile(params: {
        connection: SSHControlConnection;
        root: string;
        location: string;
        signal?: AbortSignal;
        allowMissing?: boolean;
      }): Promise<Buffer> {
        assertSafeLocation({ root: params.root, location: params.location });
        const path = resolve(params.root, params.location);
        const marker = nextMarker();
        try {
          return await runCommand({
            connection: params.connection,
            command: deps.commandEncoder.worktreeFile({ marker, path }),
            marker,
            signal: params.signal,
            maximumOutputBytes: config.maximumFileBytes,
          });
        } catch (error) {
          if (params.allowMissing) {
            return Buffer.alloc(0);
          }
          throw error;
        }
      }

      async function runExecutable(params: {
        connection: SSHControlConnection;
        executable: string;
        args: string[];
        signal?: AbortSignal;
        maximumOutputBytes?: number;
      }) {
        const marker = nextMarker();
        return await runCommand({
          connection: params.connection,
          command: deps.commandEncoder.executable({
            marker,
            executable: params.executable,
            args: params.args,
          }),
          marker,
          signal: params.signal,
          maximumOutputBytes: params.maximumOutputBytes,
        });
      }

      async function runCommand(params: {
        connection: SSHControlConnection;
        command: string;
        marker?: string;
        signal?: AbortSignal;
        maximumOutputBytes?: number;
      }) {
        const marker = params.marker ?? markerFromCommand({ command: params.command });
        return await deps.connection.execute({
          connection: params.connection,
          command: params.command,
          marker,
          signal: params.signal,
          maximumOutputBytes: params.maximumOutputBytes,
        });
      }

      function markerFromCommand(params: { command: string }) {
        const match = params.command.match(/LGTM_FRAME_[a-zA-Z0-9-]+/);
        if (!match) {
          throw new Error("SSH command is missing its frame marker.");
        }
        return match[0];
      }

      function nextMarker() {
        return `LGTM_FRAME_${deps.randomUUID()}`;
      }

      function parseNameStatus(params: { output: string }) {
        const fields = params.output.split("\0").filter(Boolean);
        const changes: Array<{ oldPath?: string; newPath?: string }> = [];
        for (let index = 0; index < fields.length; index += 1) {
          const status = fields[index];
          const path = fields[index + 1] ?? "";
          index += 1;
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

      function assertSafeLocation(params: { root: string; location: string }) {
        const isUnsafeLocation =
          !params.location || isAbsolute(params.location) || params.location.includes("\0");
        if (isUnsafeLocation) {
          throw new Error(`Unsafe remote Git path: ${params.location || "(empty)"}.`);
        }
        const path = resolve(params.root, params.location);
        const escapesRepository = path !== params.root && !path.startsWith(`${params.root}/`);
        if (escapesRepository) {
          throw new Error(`Remote Git path escapes the repository: ${params.location}.`);
        }
      }

      function assertFiles(params: { files: DiffReviewFileInput[]; message: string }) {
        if (params.files.length === 0) {
          throw new Error(params.message);
        }
      }
      return { collect };
    },
  },
);
