export function createSecretToken(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random numbers are unavailable");
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function tokenFromFragment(fragment: string): string | null {
  const token = new URLSearchParams(fragment.replace(/^#/, "")).get("token");
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function remainingTime(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function localTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const statusLabels: Record<string, string> = {
  pending: "Awaiting consent",
  active: "Consent received",
  stopped: "Stopped by participant",
  revoked: "Link revoked",
  expired: "Expired",
};
