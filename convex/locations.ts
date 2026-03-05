import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const PLATFORM_VALIDATOR = v.union(
  v.literal("ios"),
  v.literal("android"),
  v.literal("web"),
  v.literal("unknown"),
);

function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export const enrollDevice = mutation({
  args: {
    deviceUid: v.string(),
    ingestToken: v.string(),
    deviceName: v.string(),
    platform: PLATFORM_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_device_uid", (q) => q.eq("deviceUid", args.deviceUid))
      .first();

    if (existing) return { deviceUid: existing.deviceUid, ingestToken: existing.ingestToken };

    const now = Date.now();
    await ctx.db.insert("devices", {
      deviceUid: args.deviceUid,
      ingestToken: args.ingestToken,
      deviceName: args.deviceName,
      platform: args.platform,
      trackingEnabled: true,
      consentVersion: "1.0",
      consentGrantedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { deviceUid: args.deviceUid, ingestToken: args.ingestToken };
  },
});

export const ingestLocation = mutation({
  args: {
    deviceUid: v.string(),
    ingestToken: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.optional(v.number()),
    speed: v.optional(v.number()),
    heading: v.optional(v.number()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_uid", (q) => q.eq("deviceUid", args.deviceUid))
      .first();

    if (!device) throw new Error("Unknown device.");
    if (device.ingestToken !== args.ingestToken) throw new Error("Invalid token.");
    if (!device.trackingEnabled) throw new Error("Tracking disabled.");

    const now = Date.now();
    const point = {
      deviceUid: args.deviceUid,
      latitude: args.latitude,
      longitude: args.longitude,
      accuracy: args.accuracy,
      speed: args.speed,
      heading: args.heading,
      timestamp: args.timestamp,
      receivedAt: now,
    };

    await ctx.db.insert("locationHistory", point);

    const existing = await ctx.db
      .query("latestLocations")
      .withIndex("by_device_uid", (q) => q.eq("deviceUid", args.deviceUid))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, point);
    } else {
      await ctx.db.insert("latestLocations", point);
    }

    await ctx.db.patch(device._id, { lastSeenAt: now, updatedAt: now });
  },
});

export const listDevices = query({
  args: {},
  handler: async (ctx) => {
    const devices = await ctx.db.query("devices").collect();
    const latestRows = await ctx.db.query("latestLocations").collect();
    const latestMap = new Map(latestRows.map((r) => [r.deviceUid, r]));

    return devices.map((d) => ({
      deviceUid: d.deviceUid,
      deviceName: d.deviceName,
      platform: d.platform,
      trackingEnabled: d.trackingEnabled,
      lastSeenAt: d.lastSeenAt ?? null,
      latestLocation: latestMap.get(d.deviceUid) ?? null,
    }));
  },
});

export const getDevice = query({
  args: { deviceUid: v.string() },
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_uid", (q) => q.eq("deviceUid", args.deviceUid))
      .first();

    if (!device) return null;

    const latest = await ctx.db
      .query("latestLocations")
      .withIndex("by_device_uid", (q) => q.eq("deviceUid", args.deviceUid))
      .first();

    return {
      deviceUid: device.deviceUid,
      deviceName: device.deviceName,
      platform: device.platform,
      trackingEnabled: device.trackingEnabled,
      lastSeenAt: device.lastSeenAt ?? null,
      createdAt: device.createdAt,
      latestLocation: latest ?? null,
    };
  },
});

export const getDeviceHistory = query({
  args: {
    deviceUid: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const max = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("locationHistory")
      .withIndex("by_device_uid_and_timestamp", (q) => q.eq("deviceUid", args.deviceUid))
      .order("desc")
      .take(max);
  },
});
