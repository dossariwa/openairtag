import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authenticatedMutation, authenticatedQuery } from "./auth";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  CONSENT_VERSION,
  latestSharedLocation,
  sharingStatus,
} from "./sharingModel";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const LOCATION_INTERVAL_MS = 5_000;
const MAX_ACTIVE_INVITATIONS = 20;
const participantArgs = { token: v.string(), participantToken: v.string() };
const publicMetadataFields = {
  sessionId: v.id("sharingSessions"),
  recipientName: v.string(),
  recipientEmail: v.union(v.string(), v.null()),
  purpose: v.string(),
  expiresAt: v.number(),
  consentVersion: v.string(),
};
const ownerSession = v.object({
  ...publicMetadataFields,
  status: v.union(sharingStatus, v.literal("expired")),
  createdAt: v.number(),
  consentGrantedAt: v.union(v.number(), v.null()),
  latestLocation: v.union(latestSharedLocation, v.null()),
});

type Session = Doc<"sharingSessions">;
type ReadCtx = QueryCtx | MutationCtx;

function hashToken(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(token)));
}

function assertToken(token: string): void {
  if (!TOKEN_PATTERN.test(token)) {
    throw new ConvexError("Invalid sharing credentials.");
  }
}

async function findInvitation(ctx: ReadCtx, token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  return await ctx.db
    .query("sharingSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", hashToken(token)))
    .unique();
}

async function requireParticipant(ctx: ReadCtx, args: {
  token: string;
  participantToken: string;
}) {
  assertToken(args.token);
  assertToken(args.participantToken);
  const session = await findInvitation(ctx, args.token);
  if (!session || session.participantTokenHash !== hashToken(args.participantToken)) {
    throw new ConvexError("This browser cannot manage this sharing session.");
  }
  return session;
}

async function requireOwnedSession(ctx: ReadCtx, sessionId: Id<"sharingSessions">, ownerId: string) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.ownerId !== ownerId) {
    throw new ConvexError("Sharing session not found.");
  }
  return session;
}

function publicMetadata(session: Session) {
  return {
    sessionId: session._id,
    recipientName: session.recipientName,
    recipientEmail: session.recipientEmail ?? null,
    purpose: session.purpose,
    expiresAt: session.expiresAt,
    consentVersion: session.consentVersion,
  };
}

function ownerMetadata(session: Session, now: number) {
  const status = session.expiresAt <= now ? "expired" as const : session.status;
  return {
    ...publicMetadata(session),
    status,
    createdAt: session.createdAt,
    consentGrantedAt: session.consentGrantedAt ?? null,
    latestLocation: status === "active" ? session.latestLocation ?? null : null,
  };
}

function assertActive(session: Session, now: number) {
  if (session.expiresAt <= now) throw new ConvexError("This sharing link has expired.");
  if (session.status !== "active") throw new ConvexError("Location sharing is not active.");
}

export const create = authenticatedMutation({
  args: { tokenHash: v.string(), purpose: v.string(), durationMinutes: v.number() },
  returns: v.object({
    sessionId: v.id("sharingSessions"),
    expiresAt: v.number(),
    recipientName: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = ctx.identity;
    assertToken(args.tokenHash);
    if (![15, 30, 60].includes(args.durationMinutes)) {
      throw new ConvexError("Choose a sharing duration of 15, 30, or 60 minutes.");
    }
    const purpose = args.purpose.trim();
    if (purpose.length < 3 || purpose.length > 240) {
      throw new ConvexError("Explain the purpose in 3 to 240 characters.");
    }
    const recipientName = identity.name?.trim() || identity.email?.trim();
    if (!recipientName || recipientName.length > 200) {
      throw new ConvexError("Add a name or email to your account before creating a sharing link.");
    }
    const now = Date.now();
    const [pending, active, existing] = await Promise.all([
      ctx.db.query("sharingSessions")
        .withIndex("by_owner_and_status_and_expires_at", (q) =>
          q.eq("ownerId", identity.tokenIdentifier).eq("status", "pending").gt("expiresAt", now))
        .take(MAX_ACTIVE_INVITATIONS),
      ctx.db.query("sharingSessions")
        .withIndex("by_owner_and_status_and_expires_at", (q) =>
          q.eq("ownerId", identity.tokenIdentifier).eq("status", "active").gt("expiresAt", now))
        .take(MAX_ACTIVE_INVITATIONS),
      ctx.db.query("sharingSessions")
        .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
        .unique(),
    ]);
    if (pending.length + active.length >= MAX_ACTIVE_INVITATIONS) {
      throw new ConvexError("You can have up to 20 open sharing invitations. Close one first.");
    }
    if (existing) throw new ConvexError("Please generate a new sharing link.");
    const expiresAt = now + args.durationMinutes * 60_000;
    const sessionId = await ctx.db.insert("sharingSessions", {
      ownerId: identity.tokenIdentifier,
      recipientName,
      ...(identity.emailVerified === true && identity.email?.trim()
        ? { recipientEmail: identity.email.trim() }
        : {}),
      purpose,
      tokenHash: args.tokenHash,
      consentVersion: CONSENT_VERSION,
      status: "pending",
      createdAt: now,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.sharing.purgeExpired, { sessionId });
    return { sessionId, expiresAt, recipientName };
  },
});

export const getInvitation = query({
  args: { token: v.string(), participantToken: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({
    ...publicMetadataFields,
    status: sharingStatus,
    canManage: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const session = await findInvitation(ctx, args.token);
    if (!session || session.expiresAt <= Date.now()) return null;
    const canManage = !!args.participantToken
      && TOKEN_PATTERN.test(args.participantToken)
      && session.participantTokenHash === hashToken(args.participantToken);
    return { ...publicMetadata(session), status: session.status, canManage };
  },
});

export const accept = mutation({
  args: { ...participantArgs, consentVersion: v.string() },
  returns: v.object({ sessionId: v.id("sharingSessions"), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    assertToken(args.token);
    assertToken(args.participantToken);
    if (args.token === args.participantToken) {
      throw new ConvexError("Create a separate browser credential for sharing.");
    }
    const session = await findInvitation(ctx, args.token);
    const now = Date.now();
    if (!session || session.expiresAt <= now) {
      throw new ConvexError("This sharing link is no longer available.");
    }
    if (args.consentVersion !== CONSENT_VERSION || session.consentVersion !== CONSENT_VERSION) {
      throw new ConvexError("Review the current consent notice before sharing.");
    }
    const participantTokenHash = hashToken(args.participantToken);
    if (session.status === "active" && session.participantTokenHash === participantTokenHash) {
      return { sessionId: session._id, expiresAt: session.expiresAt };
    }
    if (session.status !== "pending" || session.participantTokenHash) {
      throw new ConvexError("This sharing link has already been used or closed.");
    }
    await ctx.db.patch(session._id, {
      participantTokenHash,
      consentGrantedAt: now,
      status: "active",
    });
    return { sessionId: session._id, expiresAt: session.expiresAt };
  },
});

export const updateLocation = mutation({
  args: {
    ...participantArgs,
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.number(),
    timestamp: v.number(),
  },
  returns: v.object({ accepted: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await requireParticipant(ctx, args);
    const now = Date.now();
    assertActive(session, now);
    if (!Number.isFinite(args.latitude) || args.latitude < -90 || args.latitude > 90
      || !Number.isFinite(args.longitude) || args.longitude < -180 || args.longitude > 180
      || !Number.isFinite(args.accuracy) || args.accuracy < 0 || args.accuracy > 100_000
      || !Number.isFinite(args.timestamp) || args.timestamp < now - 120_000
      || args.timestamp > now + 30_000) {
      throw new ConvexError("The browser returned an invalid or outdated location.");
    }
    if (session.latestLocation && (
      now - session.latestLocation.receivedAt < LOCATION_INTERVAL_MS
      || args.timestamp <= session.latestLocation.timestamp
    )) return { accepted: false };
    await ctx.db.patch(session._id, {
      latestLocation: {
        latitude: args.latitude,
        longitude: args.longitude,
        accuracy: args.accuracy,
        timestamp: args.timestamp,
        receivedAt: now,
      },
    });
    return { accepted: true };
  },
});

export const stop = mutation({
  args: participantArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireParticipant(ctx, args);
    // Revocation and expiry cannot be reversed, including by an old stop request.
    if (session.expiresAt <= Date.now()) {
      await ctx.db.delete(session._id);
    } else if (session.status !== "revoked") {
      await ctx.db.patch(session._id, { status: "stopped", latestLocation: undefined });
    }
    return null;
  },
});

export const deleteMine = mutation({
  args: participantArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireParticipant(ctx, args);
    await ctx.db.delete(session._id);
    return null;
  },
});

export const listMine = authenticatedQuery({
  args: {},
  returns: v.array(ownerSession),
  handler: async (ctx) => {
    const identity = ctx.identity;
    const now = Date.now();
    // Always include open invitations even when many recently closed links exist.
    const byStatus = await Promise.all(
      (["pending", "active", "stopped", "revoked"] as const).map((status) =>
        ctx.db.query("sharingSessions")
          .withIndex("by_owner_and_status_and_expires_at", (q) =>
            q.eq("ownerId", identity.tokenIdentifier).eq("status", status).gt("expiresAt", now))
          .order("desc")
          .take(status === "pending" || status === "active" ? MAX_ACTIVE_INVITATIONS : 100)),
    );
    const open = [...byStatus[0], ...byStatus[1]];
    const closed = [...byStatus[2], ...byStatus[3]]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100 - open.length);
    const sessions = [...open, ...closed].sort((a, b) => b.createdAt - a.createdAt);
    return sessions.map((session) => ownerMetadata(session, now));
  },
});

export const getMine = authenticatedQuery({
  args: { sessionId: v.id("sharingSessions") },
  returns: v.union(v.null(), ownerSession),
  handler: async (ctx, args) => {
    const identity = ctx.identity;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerId !== identity.tokenIdentifier) return null;
    return ownerMetadata(session, Date.now());
  },
});

export const revoke = authenticatedMutation({
  args: { sessionId: v.id("sharingSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(ctx, args.sessionId, ctx.identity.tokenIdentifier);
    if (session.expiresAt <= Date.now()) {
      await ctx.db.delete(session._id);
    } else {
      await ctx.db.patch(session._id, { status: "revoked", latestLocation: undefined });
    }
    return null;
  },
});

export const deleteOwned = authenticatedMutation({
  args: { sessionId: v.id("sharingSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(ctx, args.sessionId, ctx.identity.tokenIdentifier);
    await ctx.db.delete(session._id);
    return null;
  },
});

export const purgeExpired = internalMutation({
  args: { sessionId: v.id("sharingSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session && session.expiresAt <= Date.now()) await ctx.db.delete(session._id);
    return null;
  },
});
