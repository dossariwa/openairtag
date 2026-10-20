import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authenticatedMutation, authenticatedQuery, getCurrentUser, requireUser } from "./auth";
import { getDeviceLimitForUser } from "./subscriptions";
import { v } from "convex/values";

const platform = v.union(v.literal("ios"), v.literal("android"), v.literal("web"), v.literal("unknown"));
const pointFields = {
  deviceUid: v.string(), latitude: v.number(), longitude: v.number(),
  accuracy: v.optional(v.number()), batteryLevel: v.optional(v.number()),
  speed: v.optional(v.number()), heading: v.optional(v.number()),
  timestamp: v.number(), receivedAt: v.number(),
};
const latestPoint = v.object({ ...pointFields, _id: v.id("latestLocations"), _creationTime: v.number() });
const deviceFields = {
  deviceUid: v.string(), deviceName: v.string(), platform,
  trackingEnabled: v.boolean(), lastSeenAt: v.union(v.number(), v.null()),
  latestLocation: v.union(latestPoint, v.null()),
};
function validateCredential(value: string) {
  if (value.length < 16 || value.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid device credentials.");
}
function validateNewDeviceName(value: string) {
  if (!value.trim() || value.length > 120) throw new Error("Invalid device name.");
}
function ownsDevice(device: Doc<"devices">, userId: Id<"users"> | null, tokenIdentifier: string) {
  // The deployed userId is authoritative, including when both fields exist.
  return device.userId ? device.userId === userId : device.ownerId === tokenIdentifier;
}
function randomCredential(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export const createDeviceInvite = authenticatedMutation({
  args: { deviceName: v.string() },
  returns: v.object({ setupToken: v.string(), deviceUid: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateNewDeviceName(args.deviceName);
    const { limit, current } = await getDeviceLimitForUser(ctx, user._id);
    if (current >= limit) throw new Error(`Device limit reached (${current}/${limit}). Upgrade your plan to track more devices.`);
    const deviceUid = randomCredential("dev");
    const ingestToken = randomCredential("ing");
    const setupToken = randomCredential("setup");
    const now = Date.now();
    await ctx.db.insert("devices", {
      deviceUid, ingestToken, setupToken, userId: user._id, deviceName: args.deviceName,
      platform: "unknown", trackingEnabled: true, consentVersion: "1.0",
      consentGrantedAt: now, createdAt: now, updatedAt: now,
    });
    return { setupToken, deviceUid };
  },
});

// A setup token is the existing native enrollment capability. Dashboard APIs
// never disclose it or ingest credentials, and deletion invalidates it at once.
export const getDeviceBySetupToken = query({
  args: { setupToken: v.string() },
  returns: v.union(v.object({ deviceUid: v.string(), ingestToken: v.string(), deviceName: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const device = await ctx.db.query("devices").withIndex("by_setup_token", q => q.eq("setupToken", args.setupToken)).unique();
    if (!device || device.deleting) return null;
    return { deviceUid: device.deviceUid, ingestToken: device.ingestToken, deviceName: device.deviceName };
  },
});

// Preserve mobile enrollment without exposing existing tokens or dashboard data.
export const enrollDevice = mutation({
  args: { deviceUid: v.string(), ingestToken: v.string(), deviceName: v.string(), platform },
  returns: v.object({ deviceUid: v.string(), ingestToken: v.string() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    if (existing) {
      if (existing.ingestToken !== args.ingestToken || existing.deleting) throw new Error("Invalid device credentials.");
      const updates: Partial<Doc<"devices">> = {};
      if (existing.platform === "unknown" && args.platform !== "unknown") updates.platform = args.platform;
      if (existing.deviceName === "unknown" || existing.deviceName === "Device") updates.deviceName = args.deviceName;
      if (Object.keys(updates).length) await ctx.db.patch(existing._id, { ...updates, updatedAt: Date.now() });
      return { deviceUid: args.deviceUid, ingestToken: args.ingestToken };
    }
    validateNewDeviceName(args.deviceName);
    validateCredential(args.deviceUid);
    validateCredential(args.ingestToken);
    const now = Date.now();
    await ctx.db.insert("devices", { ...args, trackingEnabled: true, consentVersion: "1.0", consentGrantedAt: now, createdAt: now, updatedAt: now });
    return { deviceUid: args.deviceUid, ingestToken: args.ingestToken };
  },
});

export const claimDevice = authenticatedMutation({
  args: { deviceUid: v.string(), ingestToken: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const device = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    const fail = () => { throw new Error("Unable to pair this device. Check its pairing details."); };
    if (!device || device.deleting) return fail();
    if (device.userId) {
      if (device.userId !== user._id) return fail();
      return null;
    }
    if (device.ownerId) {
      if (device.ownerId !== ctx.identity.tokenIdentifier) return fail();
      // Already paired accounts may adopt the deployed ownership field without
      // presenting credentials again or consuming another plan slot.
      await ctx.db.patch(device._id, { userId: user._id, updatedAt: Date.now() });
      return null;
    }
    if (!args.ingestToken || device.ingestToken !== args.ingestToken) return fail();
    const { limit, current } = await getDeviceLimitForUser(ctx, user._id);
    if (current >= limit) throw new Error(`Device limit reached (${current}/${limit}). Upgrade your plan to track more devices.`);
    await ctx.db.patch(device._id, { userId: user._id, updatedAt: Date.now() });
    return null;
  },
});

export const updateDevicePlatform = mutation({
  args: { deviceUid: v.string(), ingestToken: v.string(), platform, deviceName: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    if (!device || device.deleting || device.ingestToken !== args.ingestToken) return null;
    const updates: Partial<Doc<"devices">> = {};
    if (device.platform === "unknown" && args.platform !== "unknown") updates.platform = args.platform;
    if (args.deviceName && args.deviceName !== device.deviceName) updates.deviceName = args.deviceName;
    if (Object.keys(updates).length) await ctx.db.patch(device._id, { ...updates, updatedAt: Date.now() });
    return null;
  },
});

export const ingestLocation = mutation({
  args: {
    deviceUid: v.string(), ingestToken: v.string(), latitude: v.number(), longitude: v.number(),
    accuracy: v.optional(v.number()), speed: v.optional(v.number()), heading: v.optional(v.number()), timestamp: v.number(),
  }, returns: v.null(),
  handler: async (ctx, args) => {
    const device = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    if (!device || device.ingestToken !== args.ingestToken) throw new Error("Invalid device credentials.");
    if (!device.trackingEnabled || device.deleting) throw new Error("Tracking disabled.");
    if (!Number.isFinite(args.latitude) || Math.abs(args.latitude) > 90 || !Number.isFinite(args.longitude) || Math.abs(args.longitude) > 180 || !Number.isFinite(args.timestamp) || args.timestamp < 0) throw new Error("Invalid location.");
    if (args.accuracy !== undefined && (!Number.isFinite(args.accuracy) || args.accuracy < 0)) throw new Error("Invalid accuracy.");
    for (const number of [args.speed, args.heading]) if (number !== undefined && !Number.isFinite(number)) throw new Error("Invalid location.");
    const now = Date.now();
    const point = { deviceUid: args.deviceUid, latitude: args.latitude, longitude: args.longitude, accuracy: args.accuracy, speed: args.speed, heading: args.heading, timestamp: args.timestamp, receivedAt: now };
    await ctx.db.insert("locationHistory", point);
    const latest = await ctx.db.query("latestLocations").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    if (!latest) await ctx.db.insert("latestLocations", point);
    else if (args.timestamp >= latest.timestamp) await ctx.db.patch(latest._id, point);
    await ctx.db.patch(device._id, { lastSeenAt: now, updatedAt: now });
    return null;
  },
});

export const listDevices = authenticatedQuery({
  args: {}, returns: v.array(v.object(deviceFields)),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const [legacy, paired] = await Promise.all([
      user ? ctx.db.query("devices").withIndex("by_user_id", q => q.eq("userId", user._id)).take(200) : [],
      ctx.db.query("devices").withIndex("by_owner_id", q => q.eq("ownerId", ctx.identity.tokenIdentifier)).take(200),
    ]);
    const devices = Array.from(new Map([...legacy, ...paired].map(d => [d._id, d])).values())
      .filter(d => !d.deleting && ownsDevice(d, user?._id ?? null, ctx.identity.tokenIdentifier)).slice(0, 200);
    return await Promise.all(devices.map(async d => ({
      deviceUid: d.deviceUid, deviceName: d.deviceName, platform: d.platform,
      trackingEnabled: d.trackingEnabled, lastSeenAt: d.lastSeenAt ?? null,
      latestLocation: await ctx.db.query("latestLocations").withIndex("by_device_uid", q => q.eq("deviceUid", d.deviceUid)).unique(),
    })));
  },
});

export const getDevice = authenticatedQuery({
  args: { deviceUid: v.string() }, returns: v.union(v.object({ ...deviceFields, createdAt: v.number(), isOwned: v.boolean() }), v.null()),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const d = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    if (!d || !ownsDevice(d, user?._id ?? null, ctx.identity.tokenIdentifier) || d.deleting) return null;
    return { deviceUid: d.deviceUid, deviceName: d.deviceName, platform: d.platform, trackingEnabled: d.trackingEnabled,
      lastSeenAt: d.lastSeenAt ?? null, createdAt: d.createdAt, isOwned: true,
      latestLocation: await ctx.db.query("latestLocations").withIndex("by_device_uid", q => q.eq("deviceUid", d.deviceUid)).unique(),
    };
  },
});

export const deleteDevice = authenticatedMutation({
  args: { deviceUid: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const d = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    if (!d) return null;
    if (!ownsDevice(d, user?._id ?? null, ctx.identity.tokenIdentifier)) throw new Error("Device not found.");
    await ctx.db.patch(d._id, { trackingEnabled: false, deleting: true, updatedAt: Date.now() });
    const latest = await ctx.db.query("latestLocations").withIndex("by_device_uid", q => q.eq("deviceUid", d.deviceUid)).unique();
    if (latest) await ctx.db.delete(latest._id);
    await ctx.scheduler.runAfter(0, internal.locations.purgeDeviceHistory, { deviceId: d._id });
    return null;
  },
});

export const purgeDeviceHistory = internalMutation({
  args: { deviceId: v.id("devices") }, returns: v.null(),
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.deviceId);
    if (!device?.deleting) return null;
    const rows = await ctx.db.query("locationHistory").withIndex("by_device_uid", q => q.eq("deviceUid", device.deviceUid)).take(200);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 200) await ctx.scheduler.runAfter(0, internal.locations.purgeDeviceHistory, args);
    else await ctx.db.delete(device._id);
    return null;
  },
});

export const getDeviceHistory = authenticatedQuery({
  args: { deviceUid: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ ...pointFields, _id: v.id("locationHistory"), _creationTime: v.number() })),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const d = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", args.deviceUid)).unique();
    if (!d || !ownsDevice(d, user?._id ?? null, ctx.identity.tokenIdentifier) || d.deleting) return [];
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    if (!Number.isFinite(limit)) throw new Error("Invalid limit.");
    return await ctx.db.query("locationHistory").withIndex("by_device_uid_and_timestamp", q => q.eq("deviceUid", args.deviceUid)).order("desc").take(limit);
  },
});
