// This file configures the initialization of Sentry on the client.
// Lives in src/ (not the repo root) because this project uses a src directory —
// Next.js loads the src/ copy and ignores any root-level one.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://f722d48137accc665229a308059aadd5@o4511603911032832.ingest.us.sentry.io/4511604306870272",

  // Session Replay
  integrations: [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Replay sampling: 10% of sessions, 100% of sessions with an error.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Send user PII (e.g. IP, request headers).
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

// Instruments client-side navigations for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
