// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocationSharing } from "../src/features/sharing/use-location-sharing";
import { remainingTime, tokenFromFragment } from "../src/features/sharing/tokens";

const position = () => ({
  coords: { latitude: 24.7, longitude: 46.6, accuracy: 12 },
  timestamp: Date.now(),
}) as GeolocationPosition;

describe("voluntary browser location sharing", () => {
  let success: PositionCallback;
  let failure: PositionErrorCallback;
  let watchPosition: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    clearWatch = vi.fn();
    watchPosition = vi.fn((onSuccess: PositionCallback, onFailure: PositionErrorCallback) => {
      success = onSuccess;
      failure = onFailure;
      return 42;
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { watchPosition, clearWatch },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function options() {
    return {
      expiresAt: Date.now() + 15 * 60_000,
      closed: false,
      accept: vi.fn().mockResolvedValue({}),
      sendLocation: vi.fn().mockResolvedValue({ accepted: true }),
      stopRemote: vi.fn().mockResolvedValue(null),
    };
  }

  it("does not request location or accept on mount, including when the browser already has permission", () => {
    const api = options();
    const { result } = renderHook(() => useLocationSharing(api));
    expect(result.current.phase).toBe("idle");
    expect(watchPosition).not.toHaveBeenCalled();
    expect(api.accept).not.toHaveBeenCalled();
    expect(api.sendLocation).not.toHaveBeenCalled();
  });

  it("only starts after explicit start and a successful consent record", async () => {
    const api = options();
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    expect(api.accept).toHaveBeenCalledOnce();
    expect(watchPosition).toHaveBeenCalledOnce();
    await act(async () => { success(position()); });
    expect(api.sendLocation).toHaveBeenCalledWith({ latitude: 24.7, longitude: 46.6, accuracy: 12, timestamp: Date.now() });
    expect(result.current.lastSentAt).toBe(Date.now());
  });

  it("does not collect if consent recording fails", async () => {
    const api = options();
    api.accept.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    expect(watchPosition).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("error");
  });

  it("cancels late callbacks immediately on stop and reports an unconfirmed server stop honestly", async () => {
    const api = options();
    api.stopRemote.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    const lateCallback = success;
    await act(() => result.current.stop());
    await act(async () => { lateCallback(position()); });
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(api.sendLocation).not.toHaveBeenCalled();
    expect(result.current.pendingStop).toBe(true);
    expect(result.current.message).toContain("has not confirmed the stop");
    api.stopRemote.mockResolvedValue(null);
    await act(() => result.current.stop());
    expect(result.current.pendingStop).toBe(false);
  });

  it("does not start a watcher when stopped during an in-flight consent mutation", async () => {
    const api = options();
    let accepted!: () => void;
    api.accept.mockImplementation(() => new Promise<void>((resolve) => { accepted = resolve; }));
    const { result } = renderHook(() => useLocationSharing(api));
    let starting!: Promise<void>;
    act(() => { starting = result.current.start(); });
    await act(() => result.current.stop());
    await act(async () => { accepted(); await starting; });
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("pauses on hidden tabs and never resumes automatically", async () => {
    const api = options();
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    const oldCallback = success;
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.phase).toBe("paused");
    await act(async () => { oldCallback(position()); });
    expect(api.sendLocation).not.toHaveBeenCalled();
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(watchPosition).toHaveBeenCalledOnce();
    await act(() => result.current.start());
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it("clears the watcher and ends the server session after denial or timeout", async () => {
    const api = options();
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    await act(async () => { failure({ code: 1 } as GeolocationPositionError); });
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(api.stopRemote).toHaveBeenCalledOnce();
    expect(api.sendLocation).not.toHaveBeenCalled();
    expect(result.current.message).toContain("Location permission was denied");
  });

  it("clears and ignores callbacks at expiry", async () => {
    const api = { ...options(), expiresAt: Date.now() + 1000 };
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    act(() => { vi.advanceTimersByTime(1_000); });
    await act(async () => { success(position()); });
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(result.current.phase).toBe("ended");
    expect(api.sendLocation).not.toHaveBeenCalled();
  });

  it("clears a watcher when the owner revokes the session", async () => {
    const api = options();
    const { result, rerender } = renderHook(({ closed }) => useLocationSharing({ ...api, closed }), { initialProps: { closed: false } });
    await act(() => result.current.start());
    rerender({ closed: true });
    await act(async () => { success(position()); });
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(api.sendLocation).not.toHaveBeenCalled();
  });

  it("clears the watcher on unmount and rejects its pending callbacks", async () => {
    const api = options();
    const { result, unmount } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    unmount();
    await act(async () => { success(position()); });
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(api.sendLocation).not.toHaveBeenCalled();
  });

  it("does not claim a throttled point was received", async () => {
    const api = options();
    api.sendLocation.mockResolvedValue({ accepted: false });
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    await act(async () => { success(position()); });
    expect(result.current.lastSentAt).toBeNull();
  });

  it("refuses insecure or unsupported browsers before consent or geolocation", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const api = options();
    const { result } = renderHook(() => useLocationSharing(api));
    await act(() => result.current.start());
    expect(api.accept).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(result.current.message).toContain("HTTPS");
  });
});

describe("invite parsing", () => {
  it("accepts only a complete random token from the fragment", () => {
    const token = "a".repeat(64);
    expect(tokenFromFragment(`#token=${token}`)).toBe(token);
    expect(tokenFromFragment("#token=short")).toBeNull();
    expect(tokenFromFragment("#token=" + "g".repeat(64))).toBeNull();
    expect(tokenFromFragment("#other=value")).toBeNull();
  });
  it("never shows negative remaining time", () => {
    expect(remainingTime(1_000, 2_000)).toBe("0:00");
    expect(remainingTime(61_000, 0)).toBe("1:01");
  });
});
