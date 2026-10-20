import { defineTable } from "convex/server";
import { v } from "convex/values";

export const CONSENT_VERSION = "location-sharing-v1";

export const sharingStatus = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("stopped"),
  v.literal("revoked"),
);

export const latestSharedLocation = v.object({
  latitude: v.number(),
  longitude: v.number(),
  accuracy: v.number(),
  timestamp: v.number(),
  receivedAt: v.number(),
});

/** Separate from registered devices: temporary browser sharing has no history. */
export const sharingTables = {
  sharingSessions: defineTable({
    ownerId: v.string(),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    purpose: v.string(),
    tokenHash: v.string(),
    participantTokenHash: v.optional(v.string()),
    consentVersion: v.string(),
    consentGrantedAt: v.optional(v.number()),
    status: sharingStatus,
    createdAt: v.number(),
    expiresAt: v.number(),
    latestLocation: v.optional(latestSharedLocation),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_owner_and_status_and_expires_at", [
      "ownerId",
      "status",
      "expiresAt",
    ]),
};
