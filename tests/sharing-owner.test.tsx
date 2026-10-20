// @vitest-environment jsdom

import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharesPage from "../src/app/dashboard/shares/page";
import ShareDetailPage from "../src/app/dashboard/shares/[sessionId]/page";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  deleteOwned: vi.fn(),
  replace: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@convex/_generated/api", () => ({ api: { sharing: {
  listMine: "listMine", getMine: "getMine", create: "create", revoke: "revoke", deleteOwned: "deleteOwned",
} } }));
vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
  useMutation: (name: keyof typeof mocks) => mocks[name],
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: "owner-session" }),
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => <a {...props} /> }));
vi.mock("@/components/map", () => ({ default: () => <div data-testid="sharing-map" /> }));

function session() {
  return {
    sessionId: "owner-session",
    recipientName: "Owner account",
    recipientEmail: "owner@example.test",
    purpose: "Meeting at the gate",
    expiresAt: Date.now() + 15 * 60_000,
    status: "active",
    consentGrantedAt: Date.now() - 10_000,
    latestLocation: {
      latitude: 24.7,
      longitude: 46.6,
      accuracy: 12,
      timestamp: Date.now(),
      receivedAt: Date.now(),
    },
  };
}

describe("rendered owner sharing pages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "test-map-token");
    mocks.useQuery.mockReturnValue([]);
    mocks.create.mockResolvedValue({ sessionId: "owner-session", expiresAt: Date.now() + 30 * 60_000, recipientName: "Owner account" });
    mocks.writeText.mockResolvedValue(undefined);
    mocks.deleteOwned.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function createInvitation() {
    render(<SharesPage />);
    const submit = screen.getByRole("button", { name: "Create temporary link" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why are you requesting their location?"), { target: { value: "  Meeting at the gate  " } });
    fireEvent.change(screen.getByLabelText("Link duration, starting now"), { target: { value: "30" } });
    fireEvent.click(submit);
    return await screen.findByLabelText("Private invitation link") as HTMLInputElement;
  }

  it("creates a scoped request with only a token hash and keeps the secret in the generated URL fragment", async () => {
    const field = await createInvitation();
    const link = new URL(field.value);
    const token = new URLSearchParams(link.hash.slice(1)).get("token");
    expect(link.origin).toBe(window.location.origin);
    expect(link.pathname).toBe("/share");
    expect(link.search).toBe("");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      tokenHash: createHash("sha256").update(token!).digest("hex"),
      purpose: "Meeting at the gate",
      durationMinutes: 30,
    });
    expect(screen.getByText("Owner account")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined();
    expect(mocks.writeText).toHaveBeenCalledWith(field.value);
  });

  it("keeps the generated link available for manual copying when clipboard access fails", async () => {
    mocks.writeText.mockRejectedValue(new Error("Clipboard denied"));
    const field = await createInvitation();
    const original = field.value;
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Clipboard access was unavailable. Select the link in the field and copy it manually.");
    expect(field.value).toBe(original);
    expect(field.readOnly).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("removes the map and coordinates at local expiry even before a backend update arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
    mocks.useQuery.mockReturnValue({ ...session(), expiresAt: Date.now() + 500 });
    render(<ShareDetailPage />);
    expect(screen.getByTestId("sharing-map")).toBeDefined();
    expect(screen.getByText("24.700000, 46.600000")).toBeDefined();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.queryByTestId("sharing-map")).toBeNull();
    expect(screen.queryByText("24.700000, 46.600000")).toBeNull();
    expect(screen.getByText("Expired")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Revoke link and stop sharing" })).toBeNull();
  });

  it("suppresses coordinates on revocation and retains the owner's deletion control", async () => {
    mocks.useQuery.mockReturnValue(session());
    const { rerender } = render(<ShareDetailPage />);
    expect(screen.getByTestId("sharing-map")).toBeDefined();
    // Defensive check: a closed session must not render even a cached latest point.
    mocks.useQuery.mockReturnValue({ ...session(), status: "revoked" });
    rerender(<ShareDetailPage />);
    expect(screen.queryByTestId("sharing-map")).toBeNull();
    expect(screen.queryByText("24.700000, 46.600000")).toBeNull();
    expect(screen.getByText("Link revoked")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete request and data" }));
    await act(async () => {});
    expect(mocks.deleteOwned).toHaveBeenCalledWith({ sessionId: "owner-session" });
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard/shares");
  });
});
