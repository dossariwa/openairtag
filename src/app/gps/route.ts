import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { NextRequest, NextResponse } from "next/server";

function detectPlatform(ua: string): "ios" | "android" | "web" | "unknown" {
  const lower = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(lower)) return "ios";
  if (/android/.test(lower)) return "android";
  if (/mozilla|chrome|safari|firefox/.test(lower)) return "web";
  return "unknown";
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Invalid body");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    deviceUid,
    ingestToken,
    deviceName,
    platform: bodyPlatform,
    latitude,
    longitude,
    accuracy,
    speed,
    heading,
    timestamp,
  } = body as {
    deviceUid?: string;
    ingestToken?: string;
    deviceName?: string;
    platform?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    timestamp?: number;
  };

  if (
    typeof deviceUid !== "string" || !deviceUid ||
    typeof ingestToken !== "string" || !ingestToken ||
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    typeof timestamp !== "number"
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";
  const platform = (bodyPlatform as "ios" | "android" | "web" | "unknown") || detectPlatform(ua);
  const name = deviceName || `${platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "Device"}`;

  try {
    await convex.mutation(api.locations.enrollDevice, {
      deviceUid,
      ingestToken,
      deviceName: name,
      platform,
    });

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
  } catch {
    return NextResponse.json({ error: "Unable to accept location" }, { status: 422 });
  }
}
