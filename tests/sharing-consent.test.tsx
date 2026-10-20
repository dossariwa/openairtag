// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareInvitation } from "../src/features/sharing/share-invitation";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  accept: vi.fn(),
  updateLocation: vi.fn(),
  stop: vi.fn(),
  deleteMine: vi.fn(),
}));

vi.mock("@convex/_generated/api", () => ({ api: { sharing: {
  getInvitation: "getInvitation", accept: "accept", updateLocation: "updateLocation", stop: "stop", deleteMine: "deleteMine",
} } }));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
  useMutation: (name: keyof typeof mocks) => mocks[name],
}));

const token = "a".repeat(64);

describe("rendered consent page", () => {
  let watchPosition: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    watchPosition = vi.fn().mockReturnValue(7);
    clearWatch = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition, clearWatch } });
    const stored = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    } });
    window.history.replaceState({}, "", `/share#token=${token}`);
    mocks.useQuery.mockReturnValue({
      sessionId: "session123",
      recipientName: "Recipient account",
      recipientEmail: "recipient@example.test",
      purpose: "Meeting at the gate",
      expiresAt: Date.now() + 15 * 60_000,
      status: "pending",
      consentVersion: "location-sharing-v1",
      canManage: false,
    });
    mocks.accept.mockResolvedValue({});
    mocks.stop.mockResolvedValue(null);
    mocks.deleteMine.mockResolvedValue(null);
    mocks.updateLocation.mockResolvedValue({ accepted: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows receiver and purpose, and requires both a checked consent and explicit start", async () => {
    render(<ShareInvitation />);
    const start = await screen.findByRole("button", { name: "I agree — start sharing my location" });
    expect(screen.getByText("Recipient account")).toBeDefined();
    expect(screen.getByText("recipient@example.test")).toBeDefined();
    expect(screen.getByText("Meeting at the gate")).toBeDefined();
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(watchPosition).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(watchPosition).not.toHaveBeenCalled();
    fireEvent.click(start);
    await waitFor(() => expect(watchPosition).toHaveBeenCalledOnce());
    expect(mocks.accept).toHaveBeenCalledWith(expect.objectContaining({ token, consentVersion: "location-sharing-v1" }));
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete my data" })).toBeDefined();
  });

  it("allows refusal without requesting or recording location", async () => {
    render(<ShareInvitation />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(await screen.findByText("You declined this request")).toBeDefined();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.updateLocation).not.toHaveBeenCalled();
  });

  it("restores participant controls but never resumes GPS on revisit", async () => {
    mocks.useQuery.mockReturnValue({ ...mocks.useQuery(), status: "active", canManage: true });
    render(<ShareInvitation />);
    expect(await screen.findByRole("button", { name: "Stop sharing" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete my data" })).toBeDefined();
    expect(screen.getByRole("button", { name: "I agree — resume sharing" })).toBeDefined();
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("does not let a second browser claim an already used link", async () => {
    mocks.useQuery.mockReturnValue({ ...mocks.useQuery(), status: "active", canManage: false });
    render(<ShareInvitation />);
    expect(await screen.findByText(/This link is already linked to a participant/)).toBeDefined();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("keeps deletion available after stopping", async () => {
    mocks.useQuery.mockReturnValue({ ...mocks.useQuery(), status: "stopped", canManage: true });
    render(<ShareInvitation />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete my data" }));
    expect(await screen.findByText("Sharing data deleted")).toBeDefined();
    expect(mocks.deleteMine).toHaveBeenCalledWith(expect.objectContaining({ token }));
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("rejects incomplete invite fragments before any backend call", async () => {
    window.history.replaceState({}, "", "/share#token=invalid");
    render(<ShareInvitation />);
    expect(await screen.findByText("Cannot open this request")).toBeDefined();
    expect(mocks.useQuery).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("opens a valid invitation after hash-only navigation from an invalid link", async () => {
    window.history.replaceState({}, "", "/share");
    render(<ShareInvitation />);
    expect(await screen.findByText("Cannot open this request")).toBeDefined();
    act(() => {
      window.history.replaceState({}, "", `/share#token=${token}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("button", { name: "I agree — start sharing my location" })).toBeDefined();
    expect(screen.queryByText("Cannot open this request")).toBeNull();
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("clears the prior watcher and consent when switching to another invitation fragment", async () => {
    render(<ShareInvitation />);
    const start = await screen.findByRole("button", { name: "I agree — start sharing my location" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(start);
    await waitFor(() => expect(watchPosition).toHaveBeenCalledOnce());
    const previousCallback = watchPosition.mock.calls[0][0] as PositionCallback;
    const nextToken = "b".repeat(64);
    mocks.useQuery.mockReturnValue({ ...mocks.useQuery(), sessionId: "session456", purpose: "Second request" });
    act(() => {
      window.history.replaceState({}, "", `/share#token=${nextToken}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByText("Second request")).toBeDefined();
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "I agree — start sharing my location" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Stop sharing" })).toBeNull();
    await act(async () => {
      previousCallback({ coords: { latitude: 24.7, longitude: 46.6, accuracy: 10 }, timestamp: Date.now() } as GeolocationPosition);
    });
    expect(mocks.updateLocation).not.toHaveBeenCalled();
    expect(watchPosition).toHaveBeenCalledOnce();
    expect(mocks.accept).toHaveBeenCalledOnce();
  });
});
