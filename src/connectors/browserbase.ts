// Browserbase — real cross-system synthesis via a hosted headless browser.
// Internal systems (Salesforce/Zendesk/PagerDuty) stay mocked since they need
// private auth, but Browserbase adds a genuinely live source: it browses the
// public web for recent incident/outage/news signals about the account and
// folds them into the context bundle. Drives the remote browser with
// playwright-core over CDP — no local Chromium needed.
//
// Fail-soft: no creds or any error -> returns null and the pipeline proceeds
// with mock/internal context only.
import { env } from "@/lib/env";
import type { CrossSystemContext } from "@/lib/types";

export async function pullPublicSignals(account: string): Promise<CrossSystemContext | null> {
  const cfg = env.browserbase();
  if (!cfg) return null;

  let browser: import("playwright-core").Browser | null = null;
  try {
    const { Browserbase } = await import("@browserbasehq/sdk");
    const { chromium } = await import("playwright-core");

    const bb = new Browserbase({ apiKey: cfg.key });
    const session = await bb.sessions.create({ projectId: cfg.project });

    browser = await chromium.connectOverCDP(session.connectUrl);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    const query = encodeURIComponent(`${account} outage OR incident OR downtime OR news`);
    await page.goto(`https://duckduckgo.com/html/?q=${query}`, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });

    // Pull the top few result snippets as the "public signal".
    const snippets = await page.$$eval(".result__snippet", (els) =>
      els.slice(0, 3).map((e) => (e.textContent ?? "").trim()).filter(Boolean)
    );

    const summary =
      snippets.length > 0
        ? `Public web signals: ${snippets.join(" | ").slice(0, 400)}`
        : "No notable public incident/news signals found.";

    return {
      source: "pagerduty", // bucketed under operational signals for the UI
      summary: `[browserbase/live] ${summary}`,
      facts: { liveSignalCount: snippets.length, browsedVia: "browserbase" },
    };
  } catch (e) {
    console.warn("[browserbase] live pull failed, continuing without it:", e);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
