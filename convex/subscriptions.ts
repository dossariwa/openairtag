import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./auth";

const paidTier = v.union(v.literal("starter"), v.literal("pro"));
const tier = v.union(v.literal("free"), paidTier);
const limits = { free: 1, starter: 5, pro: 20 } as const;
const subscriptionFields = {
  userId: v.id("users"),
  stripeSubscriptionId: v.string(),
  stripeCustomerId: v.string(),
  tier: paidTier,
  status: v.string(),
  currentPeriodEnd: v.number(),
  cancelAtPeriodEnd: v.boolean(),
};
const subscriptionDocument = v.object({
  ...subscriptionFields,
  _id: v.id("subscriptions"),
  _creationTime: v.number(),
});
const deviceLimit = v.object({ limit: v.number(), current: v.number(), tier });

export async function getDeviceLimitForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<{ limit: number; current: number; tier: keyof typeof limits }> {
  const subscription = await ctx.db.query("subscriptions")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .first();
  const currentTier = subscription?.status === "active" ? subscription.tier : "free";
  // Plans allow at most 20 devices. A bounded overscan preserves normal counts
  // and still denies enrollment for accounts above every supported plan limit.
  const devices = await ctx.db.query("devices")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .take(200);
  const [user, identity] = await Promise.all([ctx.db.get(userId), ctx.auth.getUserIdentity()]);
  const paired = identity && user?.clerkUserId === identity.subject
    ? await ctx.db.query("devices")
      .withIndex("by_owner_id", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .take(200)
    : [];
  const owned = new Map(devices.filter((device) => !device.deleting).map((device) => [device._id, device]));
  for (const device of paired) {
    // Canonical hosted ownership wins over the temporary ownerId compatibility field.
    if (!device.deleting && (!device.userId || device.userId === userId)) owned.set(device._id, device);
  }
  // If either bounded scan is full, omitted rows might still be active. Deny
  // further enrollment conservatively rather than undercounting after filtering.
  const current = devices.length === 200 || paired.length === 200
    ? Math.max(owned.size, limits.pro)
    : owned.size;
  return { limit: limits[currentTier], current, tier: currentTier };
}

export const getSubscription = query({
  args: {},
  returns: v.union(v.null(), subscriptionDocument),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return await ctx.db.query("subscriptions")
      .withIndex("by_user_id", (q) => q.eq("userId", user._id))
      .first();
  },
});

export const getDeviceLimit = query({
  args: {},
  returns: deviceLimit,
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? await getDeviceLimitForUser(ctx, user._id)
      : { limit: limits.free, current: 0, tier: "free" as const };
  },
});

export const canEnrollDevice = query({
  args: {},
  returns: v.object({ allowed: v.boolean(), current: v.number(), limit: v.number() }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { allowed: false, current: 0, limit: limits.free };
    const { limit, current } = await getDeviceLimitForUser(ctx, user._id);
    return { allowed: current < limit, current, limit };
  },
});

// Only a trusted server billing integration may change entitlement state.
export const upsertSubscription = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    tier: paidTier,
    status: v.string(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.currentPeriodEnd) || args.currentPeriodEnd < 0) {
      throw new Error("Invalid subscription period");
    }
    const user = await ctx.db.query("users")
      .withIndex("by_stripe_customer_id", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .first();
    if (!user) throw new Error("No user found for this Stripe customer");
    const existing = await ctx.db.query("subscriptions")
      .withIndex("by_stripe_subscription_id", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .first();
    if (existing) {
      if (existing.userId !== user._id || existing.stripeCustomerId !== args.stripeCustomerId) {
        throw new Error("Subscription belongs to another user");
      }
      await ctx.db.patch(existing._id, {
        tier: args.tier,
        status: args.status,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      });
    } else {
      await ctx.db.insert("subscriptions", { userId: user._id, ...args });
    }
    return null;
  },
});
