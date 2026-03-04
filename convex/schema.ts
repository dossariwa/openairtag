import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_clerk_user_id", ["clerkUserId"]),

  devices: defineTable({
    deviceUid: v.string(),
    ingestToken: v.string(),
    deviceName: v.string(),
    platform: v.union(
      v.literal("ios"),
      v.literal("android"),
      v.literal("web"),
      v.literal("unknown"),
    ),
    ownerLabel: v.optional(v.string()),
    consentVersion: v.string(),
    consentGrantedAt: v.number(),
    trackingEnabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_device_uid", ["deviceUid"])
    .index("by_last_seen_at", ["lastSeenAt"]),

  latestLocations: defineTable({
    deviceUid: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.optional(v.number()),
    batteryLevel: v.optional(v.number()),
    speed: v.optional(v.number()),
    heading: v.optional(v.number()),
    timestamp: v.number(),
    receivedAt: v.number(),
  }).index("by_device_uid", ["deviceUid"]),

  locationHistory: defineTable({
    deviceUid: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.optional(v.number()),
    batteryLevel: v.optional(v.number()),
    speed: v.optional(v.number()),
    heading: v.optional(v.number()),
    timestamp: v.number(),
    receivedAt: v.number(),
  })
    .index("by_device_uid", ["deviceUid"])
    .index("by_device_uid_and_timestamp", ["deviceUid", "timestamp"]),
});
