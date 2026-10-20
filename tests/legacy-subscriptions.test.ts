/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { getCurrentUser, requireCurrentUser, requireUser } from "../convex/auth";
import schema from "../convex/schema";
import * as subscriptions from "../convex/subscriptions";
import * as users from "../convex/users";

const modules = import.meta.glob("../convex/**/*.ts");
const billing = {
  stripeCustomerId: "cus_test_owner",
  stripeSubscriptionId: "sub_test_owner",
  tier: "starter" as const,
  status: "active",
  currentPeriodEnd: 1_900_000_000,
  cancelAtPeriodEnd: false,
};

async function seedDevices(t: ReturnType<typeof createTest>, userId: Id<"users">, count: number) {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index++) {
      await ctx.db.insert("devices", {
        userId,
        deviceUid: `legacy_${userId}_${index}`,
        ingestToken: `test_ingest_token_${index}`,
        deviceName: `Tracker ${index + 1}`,
        platform: "android",
        consentVersion: "1.0",
        consentGrantedAt: Date.now(),
        trackingEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
}

function createTest() {
  return convexTest(schema, modules);
}

describe("recovered user and subscription contracts", () => {
  it("preserves anonymous read defaults while denying user creation and required-user helpers", async () => {
    const t = createTest();
    await expect(t.query(api.users.currentUser, {})).resolves.toBeNull();
    await expect(t.query(api.subscriptions.getSubscription, {})).resolves.toBeNull();
    await expect(t.query(api.subscriptions.getDeviceLimit, {})).resolves.toEqual({ limit: 1, current: 0, tier: "free" });
    await expect(t.query(api.subscriptions.canEnrollDevice, {})).resolves.toEqual({ allowed: false, current: 0, limit: 1 });
    await expect(t.mutation(api.users.store, {})).rejects.toThrow("Unauthorized");
    await expect(t.query((ctx) => getCurrentUser(ctx))).resolves.toBeNull();
    await expect(t.query((ctx) => requireCurrentUser(ctx))).rejects.toThrow("Unauthorized");
    await expect(t.query((ctx) => requireUser(ctx))).rejects.toThrow("Unauthorized");
  });

  it("stores and refreshes only the signed-in user's profile without losing billing fields", async () => {
    const t = createTest();
    const owner = t.withIdentity({ subject: "owner", name: "Original name", email: "owner@example.test", pictureUrl: "https://example.test/avatar.png" });
    const userId = await owner.mutation(api.users.store, {});
    await t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "owner", stripeCustomerId: billing.stripeCustomerId });
    const updatedOwner = t.withIdentity({ subject: "owner", name: "Updated name" });
    await expect(updatedOwner.mutation(api.users.store, {})).resolves.toBe(userId);
    const current = await updatedOwner.query(api.users.currentUser, {});
    expect(current).toMatchObject({
      _id: userId,
      clerkUserId: "owner",
      name: "Updated name",
      email: "owner@example.test",
      imageUrl: "https://example.test/avatar.png",
      stripeCustomerId: billing.stripeCustomerId,
    });
    await expect(updatedOwner.query((ctx) => requireCurrentUser(ctx))).resolves.toEqual(current);
    await expect(updatedOwner.query((ctx) => requireUser(ctx))).resolves.toEqual(current);
    await expect(t.withIdentity({ subject: "different_owner" }).query(api.users.currentUser, {})).resolves.toBeNull();
    await expect(t.query(internal.users.getByClerkId, { clerkUserId: "owner" })).resolves.toEqual(current);
    await expect(t.query(internal.users.getByClerkId, { clerkUserId: "unknown" })).resolves.toBeNull();
  });

  it("keeps cross-account lookup and billing writes internal", () => {
    expect(users.getByClerkId.isInternal).toBe(true);
    expect(users.setStripeCustomerId.isInternal).toBe(true);
    expect(subscriptions.upsertSubscription.isInternal).toBe(true);
  });

  it("isolates authenticated subscription reads and device counts", async () => {
    const t = createTest();
    const owner = t.withIdentity({ subject: "owner" });
    const other = t.withIdentity({ subject: "other" });
    const ownerId = await owner.mutation(api.users.store, {});
    await other.mutation(api.users.store, {});
    await t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "owner", stripeCustomerId: billing.stripeCustomerId });
    await t.mutation(internal.subscriptions.upsertSubscription, billing);
    await seedDevices(t, ownerId, 3);

    await expect(owner.query(api.subscriptions.getSubscription, {})).resolves.toMatchObject({ userId: ownerId, ...billing });
    await expect(owner.query(api.subscriptions.getDeviceLimit, {})).resolves.toEqual({ limit: 5, current: 3, tier: "starter" });
    await expect(owner.query(api.subscriptions.canEnrollDevice, {})).resolves.toEqual({ allowed: true, current: 3, limit: 5 });
    await expect(other.query(api.subscriptions.getSubscription, {})).resolves.toBeNull();
    await expect(other.query(api.subscriptions.getDeviceLimit, {})).resolves.toEqual({ limit: 1, current: 0, tier: "free" });
    await expect(other.query(api.subscriptions.canEnrollDevice, {})).resolves.toEqual({ allowed: true, current: 0, limit: 1 });
  });

  it.each([
    { tier: "free", limit: 1 },
    { tier: "starter", limit: 5 },
    { tier: "pro", limit: 20 },
  ] as const)("enforces the recovered $tier plan device limit", async ({ tier, limit }) => {
    const t = createTest();
    const owner = t.withIdentity({ subject: "owner" });
    const userId = await owner.mutation(api.users.store, {});
    if (tier !== "free") {
      await t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "owner", stripeCustomerId: billing.stripeCustomerId });
      await t.mutation(internal.subscriptions.upsertSubscription, { ...billing, tier });
    }
    await seedDevices(t, userId, limit);
    await expect(owner.query(api.subscriptions.getDeviceLimit, {})).resolves.toEqual({ limit, current: limit, tier });
    await expect(owner.query(api.subscriptions.canEnrollDevice, {})).resolves.toEqual({ allowed: false, current: limit, limit });
  });

  it("updates an existing subscription without duplication and falls back to free after cancellation", async () => {
    const t = createTest();
    const owner = t.withIdentity({ subject: "owner" });
    await owner.mutation(api.users.store, {});
    await t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "owner", stripeCustomerId: billing.stripeCustomerId });
    await t.mutation(internal.subscriptions.upsertSubscription, billing);
    const initial = await owner.query(api.subscriptions.getSubscription, {});
    await t.mutation(internal.subscriptions.upsertSubscription, {
      ...billing, tier: "pro", status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: billing.currentPeriodEnd + 1000,
    });
    const updated = await owner.query(api.subscriptions.getSubscription, {});
    expect(updated).toMatchObject({ _id: initial?._id, tier: "pro", status: "canceled", cancelAtPeriodEnd: true });
    await expect(owner.query(api.subscriptions.getDeviceLimit, {})).resolves.toEqual({ limit: 1, current: 0, tier: "free" });
    const rows = await t.run((ctx) => ctx.db.query("subscriptions")
      .withIndex("by_stripe_subscription_id", (q) => q.eq("stripeSubscriptionId", billing.stripeSubscriptionId)).take(2));
    expect(rows).toHaveLength(1);
  });

  it("counts legacy and newly paired devices once, excluding deleted and conflicting ownership", async () => {
    const t = createTest();
    const owner = t.withIdentity({ subject: "owner", tokenIdentifier: "https://issuer.test|owner" });
    const other = t.withIdentity({ subject: "other" });
    const userId = await owner.mutation(api.users.store, {});
    const otherId = await other.mutation(api.users.store, {});
    await seedDevices(t, userId, 1);
    await t.run(async (ctx) => {
      const existing = await ctx.db.query("devices").withIndex("by_user_id", (q) => q.eq("userId", userId)).first();
      await ctx.db.patch(existing!._id, { ownerId: "https://issuer.test|owner" });
      const fields = {
        ingestToken: "test_existing_pairing_token", deviceName: "Paired tracker", platform: "ios" as const,
        ownerId: "https://issuer.test|owner", consentVersion: "1.0", consentGrantedAt: Date.now(),
        trackingEnabled: true, createdAt: Date.now(), updatedAt: Date.now(),
      };
      await ctx.db.insert("devices", { ...fields, deviceUid: "paired_compatibility_device" });
      await ctx.db.insert("devices", { ...fields, deviceUid: "deleting_compatibility_device", deleting: true });
      await ctx.db.insert("devices", { ...fields, deviceUid: "conflicting_compatibility_device", userId: otherId });
    });
    await expect(owner.query(api.subscriptions.getDeviceLimit, {})).resolves.toEqual({ limit: 1, current: 2, tier: "free" });
    await expect(owner.query(api.subscriptions.canEnrollDevice, {})).resolves.toEqual({ allowed: false, current: 2, limit: 1 });
    await expect(other.query(api.subscriptions.getDeviceLimit, {})).resolves.toEqual({ limit: 1, current: 1, tier: "free" });
  });

  it("rejects missing billing users and conflicting customer or subscription ownership", async () => {
    const t = createTest();
    const owner = t.withIdentity({ subject: "owner" });
    const other = t.withIdentity({ subject: "other" });
    await expect(t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "missing", stripeCustomerId: billing.stripeCustomerId })).rejects.toThrow("User not found");
    await expect(t.mutation(internal.subscriptions.upsertSubscription, billing)).rejects.toThrow("No user found");
    const ownerId = await owner.mutation(api.users.store, {});
    await other.mutation(api.users.store, {});
    await t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "owner", stripeCustomerId: billing.stripeCustomerId });
    await expect(t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "other", stripeCustomerId: billing.stripeCustomerId })).rejects.toThrow("another user");
    await t.mutation(internal.users.setStripeCustomerId, { clerkUserId: "other", stripeCustomerId: "cus_test_other" });
    await t.mutation(internal.subscriptions.upsertSubscription, billing);
    await expect(t.mutation(internal.subscriptions.upsertSubscription, { ...billing, stripeCustomerId: "cus_test_other", tier: "pro" })).rejects.toThrow("another user");
    await expect(owner.query(api.subscriptions.getSubscription, {})).resolves.toMatchObject({ userId: ownerId, tier: "starter", stripeCustomerId: billing.stripeCustomerId });
    await expect(other.query(api.subscriptions.getSubscription, {})).resolves.toBeNull();
  });

  it("denies enrollment conservatively when a bounded legacy device scan is full", async () => {
    const t = createTest();
    const owner = t.withIdentity({ subject: "owner" });
    const userId = await owner.mutation(api.users.store, {});
    await seedDevices(t, userId, 201);
    await t.run(async (ctx) => {
      const firstBatch = await ctx.db.query("devices").withIndex("by_user_id", (q) => q.eq("userId", userId)).take(200);
      for (const device of firstBatch) await ctx.db.patch(device._id, { deleting: true });
    });
    const enrollment = await owner.query(api.subscriptions.canEnrollDevice, {});
    expect(enrollment.allowed).toBe(false);
    expect(enrollment.current).toBeGreaterThanOrEqual(enrollment.limit);
  });
});
