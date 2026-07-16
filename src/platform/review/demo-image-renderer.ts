import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { DomainClass } from "../../domain/domain-class.ts";
import type { DemoReviewComments } from "../../domain/review/demo-review.ts";
import type { OpenReviewInput, ReviewJson } from "../../domain/review/review.ts";
import { openReview, stopReview } from "./review-platform.ts";

export type DemoImageTheme = "light" | "dark";

export class PlaywrightDemoImageRendererClass extends DomainClass<
  { width: number; height: number; quality: number; captureDelayMs: number; timeoutMs: number },
  {
    launchBrowser: typeof chromium.launch;
    mkdir: typeof mkdir;
  }
> {
  public async render(params: {
    url: string;
    output: string;
    theme: DemoImageTheme;
  }): Promise<string> {
    const output = resolve(params.output);
    await this.deps.mkdir(dirname(output), { recursive: true });
    const browser = await this.deps.launchBrowser({ headless: true });
    try {
      const page = await browser.newPage({
        colorScheme: params.theme,
        deviceScaleFactor: 1,
        viewport: { width: this.params.width, height: this.params.height },
      });
      await page.goto(params.url, {
        timeout: this.params.timeoutMs,
        waitUntil: "networkidle",
      });
      await page.locator("[data-review-ready]").waitFor({
        state: "visible",
        timeout: this.params.timeoutMs,
      });
      await page.waitForTimeout(this.params.captureDelayMs);
      await page.screenshot({
        animations: "disabled",
        path: output,
        quality: this.params.quality,
        scale: "css",
        type: "jpeg",
      });
      return output;
    } finally {
      await browser.close();
    }
  }
}

export class DemoImageRendererClass extends DomainClass<
  {},
  {
    mkdtemp: typeof mkdtemp;
    openReview: typeof openReview;
    readFile: typeof readFile;
    rm: typeof rm;
    stopReview: typeof stopReview;
    writeFile: typeof writeFile;
    renderBrowserImage: (params: {
      url: string;
      output: string;
      theme: DemoImageTheme;
    }) => Promise<string>;
  }
> {
  public async render(params: {
    comments: DemoReviewComments;
    input: OpenReviewInput;
    output: string;
    theme: DemoImageTheme;
  }): Promise<string> {
    const reviewCwd = await this.deps.mkdtemp(join(tmpdir(), "lgtm-demo-review-"));
    let pointer;
    try {
      pointer = await this.deps.openReview(params.input, {
        cwd: reviewCwd,
        openBrowser: false,
        reviewUUID: "preview",
        sessionId: "demo",
        trackAsActiveReview: false,
      });
    } catch (error) {
      await this.deps.rm(reviewCwd, { force: true, recursive: true });
      throw error;
    }
    try {
      await this.addComments({ comments: params.comments, reviewPath: pointer.reviewPath });
      return await this.deps.renderBrowserImage({
        url: pointer.url,
        output: params.output,
        theme: params.theme,
      });
    } finally {
      try {
        await this.deps.stopReview(reviewCwd, pointer.reviewPath);
      } finally {
        await this.deps.rm(reviewCwd, { force: true, recursive: true });
      }
    }
  }

  private async addComments(params: {
    comments: DemoReviewComments;
    reviewPath: string;
  }): Promise<void> {
    const review = JSON.parse(await this.deps.readFile(params.reviewPath, "utf8")) as ReviewJson;
    const files = review.files.map((file) => {
      const comments = params.comments.files.find(
        (commentedFile) => commentedFile.location === file.location,
      )?.comments;
      return comments ? { ...file, comments } : file;
    });
    await this.deps.writeFile(
      params.reviewPath,
      `${JSON.stringify(
        { ...review, files, documentComments: params.comments.documentComments },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

const PlaywrightDemoImageRenderer = new PlaywrightDemoImageRendererClass(
  { width: 1600, height: 1000, quality: 92, captureDelayMs: 1_500, timeoutMs: 20_000 },
  {
    launchBrowser: chromium.launch.bind(chromium),
    mkdir,
  },
);

export const DemoImageRenderer = new DemoImageRendererClass(
  {},
  {
    mkdtemp,
    openReview,
    readFile,
    rm,
    stopReview,
    writeFile,
    renderBrowserImage: PlaywrightDemoImageRenderer.render.bind(PlaywrightDemoImageRenderer),
  },
);
