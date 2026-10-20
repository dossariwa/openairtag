import { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";

export const verifyAuth = async (ctx: QueryCtx | MutationCtx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error("Unauthorized");
    }
    return identity;
};

// Keep the deployed helpers available for device and subscription functions.
export const getCurrentUser = async (ctx: QueryCtx | MutationCtx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.query("users")
        .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", identity.subject))
        .first();
};

export const requireCurrentUser = async (ctx: QueryCtx | MutationCtx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Unauthorized");
    return user;
};

export const requireUser = requireCurrentUser;

export const authenticatedQuery = customQuery(query, customCtx(async (ctx) => ({ identity: await verifyAuth(ctx) })));
export const authenticatedMutation = customMutation(mutation, customCtx(async (ctx) => ({ identity: await verifyAuth(ctx) })));
