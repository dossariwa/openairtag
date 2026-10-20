/// <reference types="vite/client" />
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { CONSENT_VERSION } from "../convex/sharingModel";

const modules = import.meta.glob("../convex/**/*.ts");
const token = "1".repeat(64);
const participantToken = "2".repeat(64);
const otherParticipant = "3".repeat(64);
const hash = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));
const credentials = { token, participantToken };
const createArgs = {
  tokenHash: hash(token),
  purpose: "Meet me at the park entrance",
  durationMinutes: 15,
};
const ownerIdentity = {
  subject: "owner",
  tokenIdentifier: "https://clerk.example|owner",
  issuer: "https://clerk.example",
  name: "Aisha",
  email: "aisha@example.com",
  emailVerified: true,
};

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    owner: t.withIdentity(ownerIdentity),
    otherOwner: t.withIdentity({
      ...ownerIdentity,
      subject: "other-owner",
      tokenIdentifier: "https://clerk.example|other-owner",
      name: "Other owner",
    }),
  };
}

async function activeSession() {
  const context = setup();
  const created = await context.owner.mutation(api.sharing.create, createArgs);
  await context.t.mutation(api.sharing.accept, {
    ...credentials,
    consentVersion: CONSENT_VERSION,
  });
  return { ...context, ...created };
}

function point(overrides: Partial<{
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}> = {}) {
  return {
    ...credentials,
    latitude: 24.7136,
    longitude: 46.6753,
    accuracy: 12,
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T10:00:00.000Z"));
});

afterEach(() => vi.useRealTimers());

describe("voluntary location sharing", () => {
  it("requires login and isolates owners, including identical subjects from another issuer", async () => {
    const { t, owner, otherOwner } = setup();
    await expect(t.mutation(api.sharing.create, createArgs)).rejects.toThrow("Unauthorized");
    await expect(t.query(api.sharing.listMine, {})).rejects.toThrow("Unauthorized");
    const { sessionId } = await owner.mutation(api.sharing.create, createArgs);
    await expect(t.query(api.sharing.getMine, { sessionId })).rejects.toThrow("Unauthorized");
    expect(await otherOwner.query(api.sharing.listMine, {})).toEqual([]);
    expect(await otherOwner.query(api.sharing.getMine, { sessionId })).toBeNull();
    await expect(otherOwner.mutation(api.sharing.revoke, { sessionId })).rejects.toThrow("not found");
    await expect(otherOwner.mutation(api.sharing.deleteOwned, { sessionId })).rejects.toThrow("not found");
    const otherIssuer = t.withIdentity({
      ...ownerIdentity,
      issuer: "https://another-issuer.example",
      tokenIdentifier: "https://another-issuer.example|owner",
    });
    expect(await otherIssuer.query(api.sharing.getMine, { sessionId })).toBeNull();
    expect(await owner.query(api.sharing.listMine, {})).toHaveLength(1);
  });

  it("validates creation, derives recipient identity from auth, and stores only token hashes", async () => {
    const { t, owner } = setup();
    await expect(owner.mutation(api.sharing.create, { ...createArgs, tokenHash: "short" })).rejects.toThrow();
    await expect(owner.mutation(api.sharing.create, { ...createArgs, durationMinutes: 90 })).rejects.toThrow();
    await expect(owner.mutation(api.sharing.create, { ...createArgs, purpose: "  " })).rejects.toThrow();
    const anonymousIdentity = t.withIdentity({ subject: "no-profile" });
    await expect(anonymousIdentity.mutation(api.sharing.create, createArgs)).rejects.toThrow("name or email");
    const { sessionId, expiresAt } = await owner.mutation(api.sharing.create, createArgs);
    expect(expiresAt).toBe(Date.now() + 15 * 60_000);
    const invitation = await t.query(api.sharing.getInvitation, { token });
    expect(invitation).toMatchObject({
      sessionId,
      recipientName: "Aisha",
      recipientEmail: "aisha@example.com",
      consentVersion: CONSENT_VERSION,
      status: "pending",
      canManage: false,
    });
    expect(invitation).not.toHaveProperty("ownerId");
    expect(invitation).not.toHaveProperty("tokenHash");
    expect(invitation).not.toHaveProperty("latestLocation");
    const stored = await t.run((ctx) => ctx.db.get(sessionId));
    expect(stored?.tokenHash).toBe(hash(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    await expect(owner.mutation(api.sharing.create, createArgs)).rejects.toThrow("generate a new");
    expect(await t.query(api.sharing.getInvitation, { token: "invalid" })).toBeNull();
  });

  it("does not present an unverified email as a verified recipient email", async () => {
    const { t } = setup();
    const owner = t.withIdentity({ ...ownerIdentity, emailVerified: false });
    await owner.mutation(api.sharing.create, createArgs);
    expect(await t.query(api.sharing.getInvitation, { token })).toMatchObject({
      recipientName: "Aisha",
      recipientEmail: null,
    });
  });

  it("requires current explicit consent, binds a single claimant, and makes their retry idempotent", async () => {
    const { t, owner } = setup();
    const { sessionId } = await owner.mutation(api.sharing.create, createArgs);
    await expect(t.mutation(api.sharing.updateLocation, point())).rejects.toThrow();
    await expect(t.mutation(api.sharing.accept, {
      ...credentials,
      consentVersion: "outdated-notice",
    })).rejects.toThrow("current consent");
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.status).toBe("pending");
    await expect(t.mutation(api.sharing.accept, {
      token,
      participantToken: token,
      consentVersion: CONSENT_VERSION,
    })).rejects.toThrow("separate browser credential");
    const accepted = await t.mutation(api.sharing.accept, {
      ...credentials,
      consentVersion: CONSENT_VERSION,
    });
    const consentGrantedAt = Date.now();
    vi.setSystemTime(Date.now() + 1_000);
    expect(await t.mutation(api.sharing.accept, {
      ...credentials,
      consentVersion: CONSENT_VERSION,
    })).toEqual(accepted);
    const stored = await t.run((ctx) => ctx.db.get(sessionId));
    expect(stored?.consentGrantedAt).toBe(consentGrantedAt);
    expect(stored?.participantTokenHash).toBe(hash(participantToken));
    expect(JSON.stringify(stored)).not.toContain(participantToken);
    await expect(t.mutation(api.sharing.accept, {
      token,
      participantToken: otherParticipant,
      consentVersion: CONSENT_VERSION,
    })).rejects.toThrow("already been used");
    expect(await t.query(api.sharing.getInvitation, credentials)).toMatchObject({ canManage: true });
    expect(await t.query(api.sharing.getInvitation, { token, participantToken: otherParticipant }))
      .toMatchObject({ canManage: false });
  });

  it("keeps the latest point private and rejects participant impersonation", async () => {
    const { t, owner, sessionId } = await activeSession();
    expect(await t.mutation(api.sharing.updateLocation, point())).toEqual({ accepted: true });
    const ownerView = await owner.query(api.sharing.getMine, { sessionId });
    expect(ownerView?.latestLocation).toMatchObject({ latitude: 24.7136, longitude: 46.6753, accuracy: 12 });
    expect(await t.query(api.sharing.getInvitation, credentials)).not.toHaveProperty("latestLocation");
    expect(await t.query(api.sharing.getInvitation, { token })).not.toHaveProperty("latestLocation");
    const wrongCredentials = { token, participantToken: otherParticipant };
    await expect(t.mutation(api.sharing.updateLocation, { ...point(), ...wrongCredentials })).rejects.toThrow();
    await expect(t.mutation(api.sharing.stop, wrongCredentials)).rejects.toThrow();
    await expect(t.mutation(api.sharing.deleteMine, wrongCredentials)).rejects.toThrow();
    expect((await owner.query(api.sharing.getMine, { sessionId }))?.latestLocation).not.toBeNull();
  });

  it("validates coordinates and timestamps and throttles updates without appending history", async () => {
    const { t, owner, sessionId } = await activeSession();
    for (const invalid of [
      { latitude: 91 }, { latitude: -91 }, { longitude: 181 }, { longitude: -181 },
      { latitude: NaN }, { longitude: Infinity }, { accuracy: -1 }, { accuracy: Infinity },
      { accuracy: 100_001 }, { timestamp: Date.now() - 120_001 },
      { timestamp: Date.now() + 30_001 }, { timestamp: NaN },
    ]) {
      await expect(t.mutation(api.sharing.updateLocation, point(invalid))).rejects.toThrow();
    }
    expect(await t.mutation(api.sharing.updateLocation, point())).toEqual({ accepted: true });
    const firstTimestamp = Date.now();
    vi.setSystemTime(Date.now() + 4_999);
    expect(await t.mutation(api.sharing.updateLocation, point({ latitude: 25 }))).toEqual({ accepted: false });
    vi.setSystemTime(Date.now() + 1);
    expect(await t.mutation(api.sharing.updateLocation, point({ timestamp: firstTimestamp })))
      .toEqual({ accepted: false });
    expect(await t.mutation(api.sharing.updateLocation, point({ latitude: 25 }))).toEqual({ accepted: true });
    expect((await owner.query(api.sharing.getMine, { sessionId }))?.latestLocation?.latitude).toBe(25);
    expect(await t.run((ctx) => ctx.db.query("locationHistory").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("latestLocations").take(1))).toEqual([]);
  });

  it("permanently stops sharing, erases its point, and supports participant deletion", async () => {
    const { t, owner, sessionId } = await activeSession();
    await t.mutation(api.sharing.updateLocation, point());
    await t.mutation(api.sharing.stop, credentials);
    await t.mutation(api.sharing.stop, credentials);
    expect(await owner.query(api.sharing.getMine, { sessionId })).toMatchObject({
      status: "stopped",
      latestLocation: null,
    });
    expect(await t.run((ctx) => ctx.db.get(sessionId))).not.toHaveProperty("latestLocation");
    await expect(t.mutation(api.sharing.accept, {
      ...credentials,
      consentVersion: CONSENT_VERSION,
    })).rejects.toThrow("already been used or closed");
    await expect(t.mutation(api.sharing.updateLocation, point())).rejects.toThrow("not active");
    await t.mutation(api.sharing.deleteMine, credentials);
    expect(await t.run((ctx) => ctx.db.get(sessionId))).toBeNull();
    expect(await t.query(api.sharing.getInvitation, credentials)).toBeNull();
  });

  it("lets the owner revoke or delete without allowing a late participant write", async () => {
    const { t, owner, sessionId } = await activeSession();
    await t.mutation(api.sharing.updateLocation, point());
    await owner.mutation(api.sharing.revoke, { sessionId });
    await t.mutation(api.sharing.stop, credentials);
    expect(await owner.query(api.sharing.getMine, { sessionId })).toMatchObject({
      status: "revoked",
      latestLocation: null,
    });
    expect(await t.run((ctx) => ctx.db.get(sessionId))).not.toHaveProperty("latestLocation");
    await expect(t.mutation(api.sharing.updateLocation, point())).rejects.toThrow("not active");
    await owner.mutation(api.sharing.deleteOwned, { sessionId });
    expect(await t.run((ctx) => ctx.db.get(sessionId))).toBeNull();
  });

  it("enforces expiry before cleanup executes and guards an early cleanup invocation", async () => {
    const { t, owner, sessionId, expiresAt } = await activeSession();
    await t.mutation(api.sharing.updateLocation, point());
    await t.mutation(internal.sharing.purgeExpired, { sessionId });
    expect(await t.run((ctx) => ctx.db.get(sessionId))).not.toBeNull();
    vi.setSystemTime(expiresAt);
    expect(await t.query(api.sharing.getInvitation, credentials)).toBeNull();
    expect(await owner.query(api.sharing.getMine, { sessionId })).toMatchObject({
      status: "expired",
      latestLocation: null,
    });
    expect(await owner.query(api.sharing.listMine, {})).toEqual([]);
    await expect(t.mutation(api.sharing.updateLocation, point())).rejects.toThrow("expired");
    await expect(t.mutation(api.sharing.accept, { ...credentials, consentVersion: CONSENT_VERSION }))
      .rejects.toThrow("no longer available");
    await t.mutation(internal.sharing.purgeExpired, { sessionId });
    expect(await t.run((ctx) => ctx.db.get(sessionId))).toBeNull();
  });

  it("schedules expiry to delete the entire session including consent and token hashes", async () => {
    const { t, sessionId } = await activeSession();
    await t.mutation(api.sharing.updateLocation, point());
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(sessionId))).toBeNull();
  });

  it("caps open invitations per owner while allowing a closed slot to be reused", async () => {
    const { t, owner, otherOwner } = setup();
    const created = [];
    for (let i = 1; i <= 20; i++) {
      created.push(await owner.mutation(api.sharing.create, {
        ...createArgs,
        tokenHash: hash(i.toString(16).padStart(64, "0")),
      }));
    }
    await expect(owner.mutation(api.sharing.create, createArgs)).rejects.toThrow("up to 20");
    await otherOwner.mutation(api.sharing.create, createArgs);
    expect(await owner.query(api.sharing.listMine, {})).toHaveLength(20);
    await owner.mutation(api.sharing.revoke, { sessionId: created[0].sessionId });
    await owner.mutation(api.sharing.create, { ...createArgs, tokenHash: hash("4".repeat(64)) });
    expect(await owner.query(api.sharing.listMine, {})).toHaveLength(21);
    expect(await t.query(api.sharing.getInvitation, { token })).toMatchObject({ status: "pending" });
  });

  it("does not let closed links displace open invitations from the bounded owner list", async () => {
    const { t, owner } = setup();
    const { sessionId } = await owner.mutation(api.sharing.create, createArgs);
    await t.run(async (ctx) => {
      for (let i = 0; i < 110; i++) {
        await ctx.db.insert("sharingSessions", {
          ownerId: ownerIdentity.tokenIdentifier,
          recipientName: ownerIdentity.name,
          purpose: "Closed invitation",
          tokenHash: hash(`closed-invitation-${i}`),
          consentVersion: CONSENT_VERSION,
          status: "revoked",
          createdAt: Date.now() + i,
          expiresAt: Date.now() + 60 * 60_000,
        });
      }
    });
    const sessions = await owner.query(api.sharing.listMine, {});
    expect(sessions).toHaveLength(100);
    expect(sessions.some((session) => session.sessionId === sessionId)).toBe(true);
  });
});
