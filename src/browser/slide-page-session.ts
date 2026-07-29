import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, Frame, Page } from "playwright";
import {
  createSecurityPolicy,
  sanitizeResourceLocation,
  SecurityPolicyError,
  type SecurityPolicy,
} from "../security/security-policy.js";
import type { SecurityMode } from "../types.js";
import { launchBrowser } from "./launch-browser.js";
import { waitForAssets } from "./wait-for-assets.js";

export interface OpenSlidePageOptions {
  inputPath: string;
  securityMode?: SecurityMode;
  timeoutMs?: number;
}

export interface SlidePageSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  policy: SecurityPolicy;
  assertNoBlockedResources(): void;
  close(): Promise<void>;
}

export async function openSlidePage(
  options: OpenSlidePageOptions,
): Promise<SlidePageSession> {
  const policy = await createSecurityPolicy(options);
  const browser = await launchBrowser();
  let context: BrowserContext | undefined;

  try {
    const createdContext = await browser.newContext({
      javaScriptEnabled: policy.mode === "trusted",
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    context = createdContext;

    let firstBlockedResource: SecurityPolicyError | undefined;
    let firstRouteFailure: unknown;

    const recordFailure = (error: unknown): void => {
      if (
        error instanceof SecurityPolicyError &&
        firstBlockedResource === undefined
      ) {
        firstBlockedResource = error;
      }
      firstRouteFailure ??= error;
    };

    await createdContext.route("**/*", async (route) => {
      const request = route.request();
      try {
        await policy.assertAllowed({
          url: request.url(),
          resourceType: request.resourceType(),
          isSubframeNavigation:
            request.resourceType() === "document" &&
            request.frame().parentFrame() !== null,
        });
        await route.continue();
      } catch (error) {
        recordFailure(error);
        await route.abort();
      }
    });

    const page = await createdContext.newPage();
    page.on("popup", (popup) => {
      void popup.close();
    });
    page.on("download", (download) => {
      void download.cancel();
    });
    page.on("framenavigated", (frame) => {
      void guardFrameNavigation(page, frame, policy, recordFailure);
    });

    const assertNoBlockedResources = (): void => {
      if (firstBlockedResource !== undefined) throw firstBlockedResource;
    };
    const assertNoRouteFailures = (): void => {
      assertNoBlockedResources();
      if (firstRouteFailure !== undefined) throw firstRouteFailure;
    };

    try {
      await page.goto(pathToFileURL(policy.inputPath).href, {
        waitUntil: "load",
        timeout: policy.timeoutMs,
      });
    } catch (error) {
      assertNoRouteFailures();
      throw error;
    }
    assertNoRouteFailures();

    try {
      await settleAssets(page, policy);
    } catch (error) {
      assertNoRouteFailures();
      throw error;
    }
    assertNoRouteFailures();

    let closed = false;
    return {
      browser,
      context: createdContext,
      page,
      policy,
      assertNoBlockedResources,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        try {
          await createdContext.close();
        } finally {
          await browser.close();
        }
      },
    };
  } catch (error) {
    try {
      await context?.close();
    } finally {
      await browser.close();
    }
    throw error;
  }
}

async function guardFrameNavigation(
  page: Page,
  frame: Frame,
  policy: SecurityPolicy,
  recordFailure: (error: unknown) => void,
): Promise<void> {
  const isSubframeNavigation = frame.parentFrame() !== null;
  try {
    await policy.assertAllowed({
      url: frame.url(),
      resourceType: "document",
      isSubframeNavigation,
    });
  } catch (error) {
    recordFailure(error);
    if (isSubframeNavigation) {
      const frameElement = await frame.frameElement().catch(() => undefined);
      if (frameElement !== undefined) {
        await frameElement
          .evaluate((element) => element.parentNode?.removeChild(element))
          .catch(() => undefined);
        await frameElement.dispose().catch(() => undefined);
      }
      return;
    }
    await page.close().catch(() => undefined);
  }
}

async function settleAssets(page: Page, policy: SecurityPolicy): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new SecurityPolicyError({
    code: "SECURITY_RESOURCE_TIMEOUT",
    resourceType: "assets",
    resourceLocation: sanitizeResourceLocation(policy.inputPath),
    inputPath: policy.inputPath,
    securityMode: policy.mode,
    suggestedRepair:
      "Ensure all images and fonts finish loading before the timeout.",
  });

  try {
    await Promise.race([
      waitForAssets(page),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(timeoutError), policy.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
