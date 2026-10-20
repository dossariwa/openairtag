"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Map from "@/components/map";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { localTime, remainingTime, statusLabels } from "@/features/sharing/tokens";
import { useClock } from "@/features/sharing/use-clock";

export default function ShareDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const session = useQuery(api.sharing.getMine, { sessionId: sessionId as Id<"sharingSessions"> });
  const revoke = useMutation(api.sharing.revoke);
  const deleteOwned = useMutation(api.sharing.deleteOwned);
  const [busy, setBusy] = useState<"revoke" | "delete" | null>(null);
  const [error, setError] = useState("");
  const now = useClock();

  async function changeSession(action: "revoke" | "delete") {
    if (!session) return;
    setBusy(action);
    setError("");
    try {
      if (action === "revoke") await revoke({ sessionId: session.sessionId });
      else {
        await deleteOwned({ sessionId: session.sessionId });
        router.replace("/dashboard/shares");
      }
    } catch {
      setError("The server has not confirmed this action. Stopping or deletion may not have completed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const status = session && now >= session.expiresAt ? "expired" : session?.status;
  const active = status === "active";
  const location = active ? session?.latestLocation : null;
  const stale = location ? now - location.timestamp > 60_000 : false;

  return (
    <div dir="ltr" lang="en" className="min-h-dvh bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6"><h1 className="text-xl font-bold">Location sharing request</h1><Link href="/dashboard/shares" className="text-sm text-zinc-700 underline underline-offset-4">All requests</Link></div></header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        {session === undefined ? <p role="status" className="text-sm text-zinc-600">Loading request…</p> : session === null ? <Card><CardContent><p role="status" className="text-sm leading-7">This request is unavailable. It may have expired and been automatically deleted, or it belongs to another account.</p></CardContent></Card> : <>
          <Card className="border-zinc-200 bg-white"><CardContent className="space-y-4">
            <h2 className="break-words text-lg font-semibold leading-8">{session.purpose}</h2>
            <dl className="grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-zinc-600">Status</dt><dd className="mt-1 font-semibold">{statusLabels[status ?? "pending"]}</dd></div><div><dt className="text-zinc-600">Time remaining</dt><dd dir="ltr" className="mt-1 text-left font-semibold tabular-nums">{remainingTime(session.expiresAt, now)}</dd></div><div><dt className="text-zinc-600">Participant consent time</dt><dd className="mt-1">{session.consentGrantedAt ? localTime(session.consentGrantedAt) : "Not yet accepted"}</dd></div></dl>
            <div className="flex flex-wrap gap-3">{(status === "pending" || active) && <Button className="min-h-12" variant="destructive" disabled={busy !== null} onClick={() => void changeSession("revoke")}>{busy === "revoke" ? "Confirming revocation…" : "Revoke link and stop sharing"}</Button>}<Button className="min-h-12" variant="outline" disabled={busy !== null} onClick={() => void changeSession("delete")}>{busy === "delete" ? "Confirming deletion…" : "Delete request and data"}</Button></div>
            {error && <p role="alert" className="text-sm leading-7 text-red-700">{error}</p>}
          </CardContent></Card>
          {location ? <>
            <div className="grid gap-3 sm:grid-cols-3"><Info label="Latest recorded location" value={localTime(location.timestamp)} /><Info label="Approximate accuracy" value={`± ${Math.round(location.accuracy)} meters`} /><Info label="Location freshness" value={stale ? "No update in the last minute" : "Updated within the last minute"} /></div>
            <p role="status" className={`text-sm leading-7 ${stale ? "text-amber-800" : "text-zinc-600"}`}>{stale ? "This location is stale. The participant may have hidden the page or lost connection. It does not show where they are right now." : "This is the latest received location. Accuracy can vary, and updates pause when the participant hides the page."}</p>
            <div className="rounded-xl border border-zinc-200 bg-white p-3" dir="ltr">
              {process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ? <Map className="h-[50vh] min-h-72" center={[location.longitude, location.latitude]} zoom={14} markers={[{ id: session.sessionId, latitude: location.latitude, longitude: location.longitude, label: "Latest shared location" }]} /> : <p dir="ltr" className="p-5 text-sm text-zinc-600">The map is not configured in this environment. Coordinates are available below.</p>}
            </div>
            <p className="break-words text-sm text-zinc-600">Coordinates: <span dir="ltr">{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</span></p>
          </> : <Card className="border-zinc-200 bg-white"><CardContent><p role="status" className="text-sm leading-7 text-zinc-600">{status === "pending" ? "Waiting for the person's consent. No location will appear until they explicitly agree and grant browser permission." : active ? "The person agreed, but no location has arrived yet. Their page may be paused or their device may still be locating them." : "Sharing has ended and the latest location has been deleted. No saved locations are available."}</p></CardContent></Card>}
        </>}
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-zinc-200 bg-white p-4"><p className="text-xs text-zinc-600">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>;
}
