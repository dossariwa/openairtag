import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getCurrentUser, verifyAuth } from "./auth";

const userDocument = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  clerkUserId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  verifiedAt: v.optional(v.number()),
  stripeCustomerId: v.optional(v.string()),
  createdAt: v.number(),
});

export const currentUser = query({
  args: {},
  returns: v.union(v.null(), userDocument),
  handler: getCurrentUser,
});

// Billing lookups and writes are server-only. Browser callers cannot enumerate
// another account or assign Stripe customer IDs to themselves.
export const getByClerkId = internalQuery({
  args: { clerkUserId: v.string() },
  returns: v.union(v.null(), userDocument),
  handler: async (ctx, args) => await ctx.db.query("users")
    .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", args.clerkUserId))
    .first(),
});

export const setStripeCustomerId = internalMutation({
  args: { clerkUserId: v.string(), stripeCustomerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!user) throw new Error("User not found");
    const assigned = await ctx.db.query("users")
      .withIndex("by_stripe_customer_id", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .first();
    if (assigned && assigned._id !== user._id) throw new Error("Stripe customer belongs to another user");
    await ctx.db.patch(user._id, { stripeCustomerId: args.stripeCustomerId });
    return null;
  },
});

export const store = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await verifyAuth(ctx);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) =>
        q.eq("clerkUserId", identity.subject),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: identity.name ?? existing.name,
        email: identity.email ?? existing.email,
        imageUrl: identity.pictureUrl ?? existing.imageUrl,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      clerkUserId: identity.subject,
      name: identity.name,
      email: identity.email,
      imageUrl: identity.pictureUrl,
      createdAt: Date.now(),
    });
  },
});
