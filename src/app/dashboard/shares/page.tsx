"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Copy, Link2, MapPin, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createSecretToken, hashToken, localTime, remainingTime, statusLabels } from "@/features/sharing/tokens";
import { useClock } from "@/features/sharing/use-clock";

export default function SharesPage() {
  const sessions = useQuery(api.sharing.listMine, {});
  const createSession = useMutation(api.sharing.create);
  const [purpose, setPurpose] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ link: string; expiresAt: number; recipientName: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const now = useClock();

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCopied(false);
    setCreating(true);
    try {
      if (!window.isSecureContext || !crypto.subtle) throw new Error("insecure");
      const token = createSecretToken();
      const tokenHash = await hashToken(token);
      const result = await createSession({ tokenHash, purpose: purpose.trim(), durationMinutes });
      setCreated({
        link: `${window.location.origin}/share#token=${token}`,
        expiresAt: result.expiresAt,
        recipientName: result.recipientName,
      });
      setPurpose("");
    } catch {
      setError("Could not create the link. Check that you are signed in and using a secure connection, then try again.");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      setError("Clipboard access was unavailable. Select the link in the field and copy it manually.");
    }
  }

  return (
    <div dir="ltr" lang="en" className="min-h-dvh bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h1 className="text-xl font-bold">Voluntary location sharing</h1>
          <Link href="/dashboard" className="rounded text-sm text-zinc-700 underline underline-offset-4">Device dashboard</Link>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="border-zinc-200 bg-white">
            <CardHeader><CardTitle><h2 className="flex items-center gap-2 text-lg"><Link2 aria-hidden="true" />Create a sharing request</h2></CardTitle><p className="text-sm leading-7 text-zinc-600">Send the link to one person. They will see your account and purpose, then choose whether to share.</p></CardHeader>
            <CardContent>
              <form onSubmit={create} className="space-y-4">
                <div className="space-y-2"><label htmlFor="sharing-purpose" className="text-sm font-medium">Why are you requesting their location?</label><Input id="sharing-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} required maxLength={200} minLength={3} placeholder="For example: finding our meeting point" className="min-h-12" /><p className="text-xs leading-6 text-zinc-600">The recipient will see this explanation in full.</p></div>
                <div className="space-y-2"><label htmlFor="sharing-duration" className="text-sm font-medium">Link duration, starting now</label><select id="sharing-duration" className="min-h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></div>
                <Button type="submit" className="min-h-12 w-full" disabled={creating || purpose.trim().length < 3}>{creating ? "Creating link…" : "Create temporary link"}</Button>
              </form>
            </CardContent>
          </Card>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-white p-3 text-sm leading-7 text-red-700">{error}</p>}
          {created && <Card className="border-zinc-300 bg-white"><CardHeader><CardTitle><h2 className="text-base">Your link is ready</h2></CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm leading-7">Your account will be shown as the recipient: <strong>{created.recipientName}</strong>. The link expires at {localTime(created.expiresAt)}.</p><label htmlFor="created-invite" className="text-sm font-medium">Private invitation link</label><Input id="created-invite" dir="ltr" readOnly value={created.link} onFocus={(event) => event.target.select()} className="min-h-12 text-xs" /><Button className="min-h-12 w-full" variant="outline" onClick={() => void copyLink()}><Copy aria-hidden="true" />{copied ? "Copied" : "Copy link"}</Button><p role="status" className="text-xs leading-6 text-zinc-600">Save the link now; we cannot retrieve its original secret later. Send it only to the intended person. This link requests location sharing and does not reveal location data.</p></CardContent></Card>}
          <p className="flex gap-2 text-sm leading-7 text-zinc-600"><ShieldCheck aria-hidden="true" className="mt-1 size-4 shrink-0" /><span>Only the latest location is kept. The participant can stop or delete the session, and it is automatically deleted when the link expires.</span></p>
        </div>
        <section className="min-w-0" aria-labelledby="sharing-sessions-title">
          <h2 id="sharing-sessions-title" className="text-lg font-semibold">Your temporary requests</h2>
          <p className="mt-1 text-sm leading-7 text-zinc-600">Only your account can view locations shared through these requests. Your existing device tracking stays separate.</p>
          <div className="mt-4 space-y-3">
            {sessions === undefined && <p role="status" className="text-sm text-zinc-600">Loading requests…</p>}
            {sessions?.length === 0 && <Card className="border-zinc-200 bg-white"><CardContent className="pt-1"><p className="text-sm leading-7 text-zinc-600">No sharing requests yet. Create a link to receive a location after the participant agrees.</p></CardContent></Card>}
            {sessions?.map((session) => {
              const status = now >= session.expiresAt ? "expired" : session.status;
              return <Link key={session.sessionId} href={`/dashboard/shares/${session.sessionId}`} className="block rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2"><div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-sm font-semibold leading-7">{session.purpose}</h3><MapPin aria-hidden="true" className="mt-1 size-4 shrink-0 text-zinc-500" /></div><p className="mt-2 text-xs font-medium text-zinc-700">{statusLabels[status]}</p><p className="mt-1 text-xs leading-6 text-zinc-600">Remaining <span dir="ltr" className="tabular-nums">{remainingTime(session.expiresAt, now)}</span> · {session.latestLocation && status === "active" ? `Latest location: ${localTime(session.latestLocation.timestamp)}` : "No location available"}</p></Link>;
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
