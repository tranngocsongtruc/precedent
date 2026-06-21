import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { buildGraph, ensureIndex } from "@/lib/redis";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureIndex();
    const graph = await buildGraph();
    return NextResponse.json(graph);
  } catch (e) {
    Sentry.captureException(e);
    console.error("[/api/graph] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "graph failed" },
      { status: 500 }
    );
  }
}
