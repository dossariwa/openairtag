/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const device = {
  deviceUid: "dev_existing_tracker_001",
  ingestToken: "ing_existing_tracker_secret_001",
  deviceName: "Existing tracker",
  platform: "ios" as const,
};
const credentials = {
  deviceUid: device.deviceUid,
  ingestToken: device.ingestToken,
};
const point = {
  ...credentials,
  latitude: 24.7136,
  longitude: 46.6753,
  accuracy: 12,
  timestamp: 1_700_000_000_000,
};

afterEach(() => vi.useRealTimers());

describe("device authorization and existing tracker compatibility", () => {
  it("denies unauthenticated dashboard reads, pairing, and deletion", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.locations.enrollDevice, device);
    await t.mutation(api.locations.ingestLocation, point);

    await expect(t.query(api.locations.listDevices, {})).rejects.toThrow("Unauthorized");
    await expect(t.query(api.locations.getDevice, { deviceUid: device.deviceUid })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid })).rejects.toThrow("Unauthorized");
    await expect(t.mutation(api.locations.claimDevice, credentials)).rejects.toThrow("Unauthorized");
    await expect(t.mutation(api.locations.deleteDevice, { deviceUid: device.deviceUid })).rejects.toThrow("Unauthorized");
  });

  it("requires the existing token to claim an unowned device", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "owner_a" });
    await owner.mutation(api.users.store, {});
    await t.mutation(api.locations.enrollDevice, device);

    await expect(owner.query(api.locations.listDevices, {})).resolves.toEqual([]);
    await expect(owner.mutation(api.locations.claimDevice, { deviceUid: device.deviceUid })).rejects.toThrow("Unable to pair this device");
    await expect(owner.mutation(api.locations.claimDevice, {
      ...credentials,
      ingestToken: "ing_incorrect_tracker_secret",
    })).rejects.toThrow("Unable to pair this device");
    await expect(owner.query(api.locations.getDevice, { deviceUid: device.deviceUid })).resolves.toBeNull();

    await expect(owner.mutation(api.locations.claimDevice, credentials)).resolves.toBeNull();
    await expect(owner.mutation(api.locations.claimDevice, credentials)).resolves.toBeNull();
    const paired = await owner.query(api.locations.getDevice, { deviceUid: device.deviceUid });
    expect(paired).toMatchObject({ deviceUid: device.deviceUid, deviceName: device.deviceName });
    expect(paired).not.toHaveProperty("ingestToken");
  });

  it("isolates devices, location history, and deletion between account owners", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "owner_a" });
    await owner.mutation(api.users.store, {});
    const other = t.withIdentity({ subject: "owner_b" });
    await other.mutation(api.users.store, {});
    await t.mutation(api.locations.enrollDevice, device);
    await t.mutation(api.locations.ingestLocation, point);
    await owner.mutation(api.locations.claimDevice, credentials);

    const otherDevice = { ...device, deviceUid: "dev_second_tracker_002", ingestToken: "ing_second_tracker_secret_002" };
    await t.mutation(api.locations.enrollDevice, otherDevice);
    await other.mutation(api.locations.claimDevice, { deviceUid: otherDevice.deviceUid, ingestToken: otherDevice.ingestToken });

    expect((await owner.query(api.locations.listDevices, {})).map((row) => row.deviceUid)).toEqual([device.deviceUid]);
    expect((await other.query(api.locations.listDevices, {})).map((row) => row.deviceUid)).toEqual([otherDevice.deviceUid]);
    await expect(other.query(api.locations.getDevice, { deviceUid: device.deviceUid })).resolves.toBeNull();
    await expect(other.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid })).resolves.toEqual([]);
    await expect(other.mutation(api.locations.claimDevice, credentials)).rejects.toThrow("Unable to pair this device");
    await expect(other.mutation(api.locations.deleteDevice, { deviceUid: device.deviceUid })).rejects.toThrow("Device not found");
    await expect(owner.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid })).resolves.toHaveLength(1);
  });

  it("never returns the stored token when re-enrollment supplies the wrong token", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.locations.enrollDevice, device);
    const error = await t.mutation(api.locations.enrollDevice, {
      ...device,
      ingestToken: "ing_incorrect_tracker_secret",
      deviceName: "Attempted replacement",
    }).then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Invalid device credentials");
    expect(String(error)).not.toContain(device.ingestToken);
    await expect(t.mutation(api.locations.enrollDevice, device)).resolves.toEqual(credentials);
    const stored = await t.run((ctx) => ctx.db.query("devices")
      .withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).unique());
    expect(stored).toMatchObject({ deviceName: device.deviceName, ingestToken: device.ingestToken });
  });

  it("preserves hosted userId ownership without re-pairing, even with a conflicting ownerId", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "legacy_owner", tokenIdentifier: "issuer|legacy_owner" });
    const other = t.withIdentity({ subject: "other_owner", tokenIdentifier: "issuer|other_owner" });
    const userId = await owner.mutation(api.users.store, {});
    await other.mutation(api.users.store, {});
    await t.mutation(api.locations.enrollDevice, device);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", device.deviceUid)).unique();
      await ctx.db.patch(row!._id, { userId, ownerId: "issuer|other_owner", setupToken: "existing_setup_token" });
    });
    await t.mutation(api.locations.ingestLocation, point);

    expect((await owner.query(api.locations.listDevices, {})).map(row => row.deviceUid)).toEqual([device.deviceUid]);
    expect(await owner.query(api.locations.getDevice, { deviceUid: device.deviceUid })).toMatchObject({
      isOwned: true, latestLocation: { latitude: point.latitude },
    });
    await expect(owner.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid })).resolves.toHaveLength(1);
    await expect(owner.mutation(api.locations.claimDevice, { deviceUid: device.deviceUid })).resolves.toBeNull();
    await expect(other.query(api.locations.listDevices, {})).resolves.toEqual([]);
    await expect(other.query(api.locations.getDevice, { deviceUid: device.deviceUid })).resolves.toBeNull();
    await expect(other.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid })).resolves.toEqual([]);
    await expect(other.mutation(api.locations.claimDevice, credentials)).rejects.toThrow("Unable to pair this device");
    await expect(other.mutation(api.locations.deleteDevice, { deviceUid: device.deviceUid })).rejects.toThrow("Device not found");
    // Existing setup capabilities continue to enroll native trackers.
    await expect(t.query(api.locations.getDeviceBySetupToken, { setupToken: "existing_setup_token" })).resolves.toEqual({
      ...credentials, deviceName: device.deviceName,
    });
  });

  it("preserves ownerId-only pairing and adopts userId without consuming another device slot", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "owner_a", tokenIdentifier: "issuer|owner_a" });
    const other = t.withIdentity({ subject: "owner_b", tokenIdentifier: "issuer|owner_b" });
    const userId = await owner.mutation(api.users.store, {});
    await other.mutation(api.users.store, {});
    await t.mutation(api.locations.enrollDevice, device);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", device.deviceUid)).unique();
      await ctx.db.patch(row!._id, { ownerId: "issuer|owner_a" });
    });

    await expect(owner.query(api.locations.listDevices, {})).resolves.toHaveLength(1);
    await expect(other.mutation(api.locations.claimDevice, credentials)).rejects.toThrow("Unable to pair this device");
    await expect(owner.mutation(api.locations.createDeviceInvite, { deviceName: "Over the free limit" })).rejects.toThrow("Device limit reached");
    await expect(owner.mutation(api.locations.claimDevice, { deviceUid: device.deviceUid })).resolves.toBeNull();
    const migrated = await t.run(ctx => ctx.db.query("devices").withIndex("by_device_uid", q => q.eq("deviceUid", device.deviceUid)).unique());
    expect(migrated?.userId).toBe(userId);
    await expect(owner.query(api.locations.listDevices, {})).resolves.toHaveLength(1);
  });

  it("preserves invite/setup/platform contracts and enforces device limits for new ownership", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "owner_a" });
    await owner.mutation(api.users.store, {});
    await expect(t.mutation(api.locations.createDeviceInvite, { deviceName: "Device" })).rejects.toThrow("Unauthorized");
    const invite = await owner.mutation(api.locations.createDeviceInvite, { deviceName: "Device" });
    expect(invite.setupToken).toMatch(/^setup_[a-f0-9]{64}$/);
    expect(invite.deviceUid).toMatch(/^dev_[a-f0-9]{64}$/);
    const setup = await t.query(api.locations.getDeviceBySetupToken, { setupToken: invite.setupToken });
    expect(setup).toMatchObject({ deviceUid: invite.deviceUid, deviceName: "Device" });
    expect(setup?.ingestToken).toMatch(/^ing_[a-f0-9]{64}$/);
    await expect(t.query(api.locations.getDeviceBySetupToken, { setupToken: "incorrect_setup_token" })).resolves.toBeNull();

    await t.mutation(api.locations.updateDevicePlatform, {
      deviceUid: invite.deviceUid, ingestToken: "invalid_ingest_token", platform: "android", deviceName: "Wrong name",
    });
    expect(await owner.query(api.locations.getDevice, { deviceUid: invite.deviceUid })).toMatchObject({ platform: "unknown", deviceName: "Device" });
    await expect(t.mutation(api.locations.enrollDevice, {
      deviceUid: setup!.deviceUid, ingestToken: setup!.ingestToken, deviceName: "Native phone", platform: "ios",
    })).resolves.toEqual({ deviceUid: setup!.deviceUid, ingestToken: setup!.ingestToken });
    await t.mutation(api.locations.updateDevicePlatform, {
      deviceUid: setup!.deviceUid, ingestToken: setup!.ingestToken, platform: "android", deviceName: "Renamed phone",
    });
    expect(await owner.query(api.locations.getDevice, { deviceUid: invite.deviceUid })).toMatchObject({ platform: "ios", deviceName: "Renamed phone", isOwned: true });
    await expect(owner.mutation(api.locations.claimDevice, { deviceUid: invite.deviceUid })).resolves.toBeNull();
    await expect(owner.mutation(api.locations.createDeviceInvite, { deviceName: "Second phone" })).rejects.toThrow("Device limit reached");
    await t.mutation(api.locations.enrollDevice, device);
    await expect(owner.mutation(api.locations.claimDevice, credentials)).rejects.toThrow("Device limit reached");

    await owner.mutation(api.locations.deleteDevice, { deviceUid: invite.deviceUid });
    await expect(t.query(api.locations.getDeviceBySetupToken, { setupToken: invite.setupToken })).resolves.toBeNull();
    await t.mutation(api.locations.updateDevicePlatform, {
      deviceUid: setup!.deviceUid, ingestToken: setup!.ingestToken, platform: "web", deviceName: "Deleted phone",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.query(api.locations.getDeviceBySetupToken, { setupToken: invite.setupToken })).resolves.toBeNull();
  });

  it("preserves anonymous self-enrollment and ingestion before and after pairing", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "owner_a" });
    await owner.mutation(api.users.store, {});
    await expect(t.mutation(api.locations.enrollDevice, device)).resolves.toEqual(credentials);
    await expect(t.mutation(api.locations.ingestLocation, point)).resolves.toBeNull();
    await expect(owner.query(api.locations.listDevices, {})).resolves.toEqual([]);

    await owner.mutation(api.locations.claimDevice, credentials);
    const newer = { ...point, latitude: 24.72, timestamp: point.timestamp + 2_000 };
    const delayed = { ...point, latitude: 24.71, timestamp: point.timestamp + 1_000 };
    await t.mutation(api.locations.ingestLocation, newer);
    await t.mutation(api.locations.ingestLocation, delayed);

    const paired = await owner.query(api.locations.getDevice, { deviceUid: device.deviceUid });
    expect(paired?.latestLocation).toMatchObject({ latitude: newer.latitude, timestamp: newer.timestamp });
    const listed = await owner.query(api.locations.listDevices, {});
    expect(listed).toHaveLength(1);
    expect(listed[0].latestLocation).toMatchObject({ latitude: newer.latitude, timestamp: newer.timestamp });
    expect(listed[0]).not.toHaveProperty("ingestToken");
    const history = await owner.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid });
    expect(history.map((entry) => entry.timestamp)).toEqual([newer.timestamp, delayed.timestamp, point.timestamp]);
    await expect(owner.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid, limit: 2 })).resolves.toHaveLength(2);
    await expect(t.mutation(api.locations.ingestLocation, { ...point, ingestToken: "ing_incorrect_tracker_secret" })).rejects.toThrow("Invalid device credentials");
  });

  it("preserves long legacy device names while validating newly enrolled names", async () => {
    const t = convexTest(schema, modules);
    const legacy = { ...device, deviceName: "Legacy tracker ".repeat(10) };
    await t.run((ctx) => ctx.db.insert("devices", {
      ...legacy,
      trackingEnabled: true,
      consentVersion: "1.0",
      consentGrantedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    // /gps re-enrolls with the native device name before sending every point.
    await expect(t.mutation(api.locations.enrollDevice, legacy)).resolves.toEqual(credentials);
    await expect(t.mutation(api.locations.ingestLocation, point)).resolves.toBeNull();
    const latest = await t.run((ctx) => ctx.db.query("latestLocations")
      .withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).unique());
    expect(latest).toMatchObject({ latitude: point.latitude, timestamp: point.timestamp });

    for (const deviceName of [legacy.deviceName, "   "]) {
      await expect(t.mutation(api.locations.enrollDevice, {
        ...device,
        deviceUid: "dev_new_invalid_name_tracker",
        deviceName,
      })).rejects.toThrow("Invalid device name");
    }
  });

  it("hides deleted devices immediately, rejects updates, and purges history in scheduled batches", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "owner_a" });
    await owner.mutation(api.users.store, {});
    await t.mutation(api.locations.enrollDevice, device);
    await t.mutation(api.locations.ingestLocation, point);
    await owner.mutation(api.locations.claimDevice, credentials);
    await t.run(async (ctx) => {
      for (let index = 1; index <= 404; index++) {
        await ctx.db.insert("locationHistory", {
          deviceUid: device.deviceUid,
          latitude: point.latitude,
          longitude: point.longitude,
          timestamp: point.timestamp + index,
          receivedAt: Date.now(),
        });
      }
    });

    await owner.mutation(api.locations.deleteDevice, { deviceUid: device.deviceUid });
    await expect(owner.query(api.locations.listDevices, {})).resolves.toEqual([]);
    await expect(owner.query(api.locations.getDevice, { deviceUid: device.deviceUid })).resolves.toBeNull();
    await expect(owner.query(api.locations.getDeviceHistory, { deviceUid: device.deviceUid })).resolves.toEqual([]);
    await expect(t.mutation(api.locations.ingestLocation, point)).rejects.toThrow("Tracking disabled");
    await expect(t.mutation(api.locations.enrollDevice, device)).rejects.toThrow("Invalid device credentials");
    await expect(owner.mutation(api.locations.claimDevice, credentials)).rejects.toThrow("Unable to pair this device");
    const pending = await t.run(async (ctx) => ({
      device: await ctx.db.query("devices").withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).unique(),
      latest: await ctx.db.query("latestLocations").withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).unique(),
      history: await ctx.db.query("locationHistory").withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).take(406),
    }));
    expect(pending.device).toMatchObject({ deleting: true, trackingEnabled: false });
    expect(pending.latest).toBeNull();
    expect(pending.history).toHaveLength(405);

    // Run one scheduled batch first so the test exercises continuation, not just deletion.
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const firstBatch = await t.run(async (ctx) => ({
      device: await ctx.db.query("devices").withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).unique(),
      history: await ctx.db.query("locationHistory").withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).take(406),
    }));
    expect(firstBatch.device).not.toBeNull();
    expect(firstBatch.history).toHaveLength(205);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const purged = await t.run(async (ctx) => ({
      device: await ctx.db.query("devices").withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).unique(),
      history: await ctx.db.query("locationHistory").withIndex("by_device_uid", (q) => q.eq("deviceUid", device.deviceUid)).take(1),
    }));
    expect(purged.device).toBeNull();
    expect(purged.history).toEqual([]);
    await expect(t.mutation(api.locations.ingestLocation, point)).rejects.toThrow("Invalid device credentials");
  });
});
