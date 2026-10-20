"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PairDevice() {
  const claim = useMutation(api.locations.claimDevice);
  const [deviceUid, setDeviceUid] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <details className="mt-5 rounded-lg border border-zinc-300 bg-white p-4">
    <summary className="cursor-pointer font-medium">Pair an existing device</summary>
    <p className="mt-3 text-sm text-zinc-600">Open “Show pairing details” in the tracker app on your device. Pairing links its locations to your signed-in account. Existing devices need to be paired once.</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage("");
      try { await claim({ deviceUid: deviceUid.trim(), ingestToken: token.trim() }); setToken(""); setDeviceUid(""); setMessage("Device paired to your account."); }
      catch { setMessage("Unable to pair. Check the details and make sure the tracker has sent a location."); }
      finally { setBusy(false); }
    }}>
      <label className="grid gap-1 text-sm">Device ID<Input value={deviceUid} onChange={e => setDeviceUid(e.target.value)} autoComplete="off" required maxLength={160} /></label>
      <label className="grid gap-1 text-sm">Pairing token<Input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" required maxLength={160} /></label>
      <Button className="min-h-11 sm:w-fit" disabled={busy}>{busy ? "Pairing…" : "Pair device"}</Button>
      <p role="status" className="text-sm text-zinc-700">{message}</p>
    </form>
  </details>;
}
