import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { NextRequest, NextResponse } from "next/server";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const INGEST_SECRET = process.env.INGEST_SECRET;

export async function POST(req: NextRequest) {
  if (INGEST_SECRET) {
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token !== INGEST_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { deviceUid, ingestToken, latitude, longitude, accuracy, speed, heading, timestamp } =
    body as {
      deviceUid?: string;
      ingestToken?: string;
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      speed?: number;
      heading?: number;
      timestamp?: number;
    };

  if (
    !deviceUid ||
    !ingestToken ||
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    typeof timestamp !== "number"
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    await convex.mutation(api.locations.ingestLocation, {
      deviceUid,
      ingestToken,
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      timestamp,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
