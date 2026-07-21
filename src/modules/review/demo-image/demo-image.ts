import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { build, defineBuilderDeps } from "../../../builder.ts";
import type { DemoReviewComments } from "../demo/demo.ts";
import type { OpenReviewInput, ReviewJson } from "../review/review.ts";
import { openReview, stopReview } from "../server/server.ts";

export type DemoImageTheme = "light" | "dark";

export const { PlaywrightDemoImageService, PlaywrightDemoImageServiceBuilder } = build().service(
  "PlaywrightDemoImageService",
  {
    config: { width: 1600, height: 1000, quality: 92, captureDelayMs: 1_500, timeoutMs: 20_000 },
    deps: defineBuilderDeps<{
      launchBrowser: typeof chromium.launch;
      mkdir: typeof mkdir;
    }>({
      launchBrowser: chromium.launch.bind(chromium),
      mkdir,
    }),
    build({ config, deps }) {
      async function render(params: {
        url: string;
        output: string;
        theme: DemoImageTheme;
      }): Promise<string> {
        const output = resolve(params.output);
        await deps.mkdir(dirname(output), { recursive: true });
        const browser = await deps.launchBrowser({ headless: true });
        try {
          const page = await browser.newPage({
            colorScheme: params.theme,
            deviceScaleFactor: 1,
            viewport: { width: config.width, height: config.height },
          });
          await page.goto(params.url, {
            timeout: config.timeoutMs,
            waitUntil: "networkidle",
          });
          await page.locator("[data-review-ready]").waitFor({
            state: "visible",
            timeout: config.timeoutMs,
          });
          await page.waitForTimeout(config.captureDelayMs);
          await page.screenshot({
            animations: "disabled",
            path: output,
            quality: config.quality,
            scale: "css",
            type: "jpeg",
          });
          return output;
        } finally {
          await browser.close();
        }
      }

      return { render };
    },
  },
);

export const { DemoImageService, DemoImageServiceBuilder } = build().service("DemoImageService", {
  config: {},
  deps: {
    mkdtemp,
    openReview,
    readFile,
    rm,
    stopReview,
    writeFile,
    renderBrowserImage: PlaywrightDemoImageService.render,
  },
  build({ deps }) {
    async function addComments(params: {
      comments: DemoReviewComments;
      reviewPath: string;
    }): Promise<void> {
      const review = JSON.parse(await deps.readFile(params.reviewPath, "utf8")) as ReviewJson;
      const files = review.files.map(function addFileComments(file) {
        const comments = params.comments.files.find(function findCommentedFile(commentedFile) {
          return commentedFile.location === file.location;
        })?.comments;
        return comments ? { ...file, comments } : file;
      });
      await deps.writeFile(
        params.reviewPath,
        `${JSON.stringify(
          { ...review, files, documentComments: params.comments.documentComments },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    async function render(params: {
      comments: DemoReviewComments;
      input: OpenReviewInput;
      output: string;
      theme: DemoImageTheme;
    }): Promise<string> {
      const reviewCwd = await deps.mkdtemp(join(tmpdir(), "lgtm-demo-review-"));
      let pointer;
      try {
        pointer = await deps.openReview(params.input, {
          cwd: reviewCwd,
          openBrowser: false,
          reviewUUID: "preview",
          sessionId: "demo",
          trackAsActiveReview: false,
        });
      } catch (error) {
        await deps.rm(reviewCwd, { force: true, recursive: true });
        throw error;
      }
      try {
        await addComments({ comments: params.comments, reviewPath: pointer.reviewPath });
        return await deps.renderBrowserImage({
          url: pointer.url,
          output: params.output,
          theme: params.theme,
        });
      } finally {
        try {
          await deps.stopReview(reviewCwd, pointer.reviewPath);
        } finally {
          await deps.rm(reviewCwd, { force: true, recursive: true });
        }
      }
    }

    return { render };
  },
});
