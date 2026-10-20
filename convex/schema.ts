import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { sharingTables } from "./sharingModel";

export default defineSchema({
  ...sharingTables,
  users: defineTable({
    clerkUserId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_clerk_user_id", ["clerkUserId"])
    .index("by_stripe_customer_id", ["stripeCustomerId"]),

  subscriptions: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    tier: v.union(v.literal("starter"), v.literal("pro")),
    status: v.string(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  })
    .index("by_user_id", ["userId"])
    .index("by_stripe_subscription_id", ["stripeSubscriptionId"]),

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
    ownerId: v.optional(v.string()),
    // Retain ownership and setup links already used by the hosted tracker.
    userId: v.optional(v.id("users")),
    setupToken: v.optional(v.string()),
    deleting: v.optional(v.boolean()),
    consentVersion: v.string(),
    consentGrantedAt: v.number(),
    trackingEnabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_device_uid", ["deviceUid"])
    .index("by_owner_id", ["ownerId"])
    .index("by_user_id", ["userId"])
    .index("by_setup_token", ["setupToken"])
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
