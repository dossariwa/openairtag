"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { MapPin, ShieldCheck, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSecretToken, hashToken, localTime, remainingTime, tokenFromFragment } from "./tokens";
import { useClock } from "./use-clock";
import { useLocationSharing, type SharedPosition } from "./use-location-sharing";

type Credentials = { token: string; participantToken: string; storageKey: string };

export function ShareInvitation() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    // URL fragments and browser storage are intentionally read only in the client.
    const loadInvitation = async () => {
      if (cancelled) return;
      const currentRevision = ++revision;
      setCredentials(null);
      setError("");
      const token = tokenFromFragment(window.location.hash);
      if (!token) {
        setError("This link is incomplete or invalid. Ask the sender for a new sharing link.");
        return;
      }
      if (!window.isSecureContext || !crypto.subtle) {
        setError("Open this link over a secure HTTPS connection to view the request.");
        return;
      }
      try {
        const digest = await hashToken(token);
        if (cancelled || currentRevision !== revision) return;
        const storageKey = `openairtag:participant:${digest}`;
        const saved = window.localStorage.getItem(storageKey);
        const participantToken = saved && /^[a-f0-9]{64}$/.test(saved) ? saved : createSecretToken();
        setCredentials({ token, participantToken, storageKey });
      } catch {
        if (!cancelled && currentRevision === revision) {
          setError("Could not open this link securely. Your browser must allow local storage so you can return to stop sharing or delete your data.");
        }
      }
    };
    const onHashChange = () => { void loadInvitation(); };
    window.addEventListener("hashchange", onHashChange);
    void Promise.resolve().then(onHashChange);
    return () => {
      cancelled = true;
      revision += 1;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return (
    <main lang="en" dir="ltr" className="min-h-dvh bg-zinc-50 px-4 py-6 text-zinc-900 sm:py-12">
      <div className="mx-auto max-w-xl">
        <p className="mb-5 text-center text-sm font-semibold" dir="ltr">OpenAirTag</p>
        {error ? <MessageCard title="Cannot open this request" message={error} />
          : credentials ? <InvitationDetails key={credentials.token} credentials={credentials} />
            : <MessageCard title="Opening sharing request…" message="Your location will not be requested without your explicit consent." />}
        <p className="mt-5 text-center text-xs leading-6 text-zinc-600">
          Opening this link does not share your location. You can decline and close this page.
        </p>
      </div>
    </main>
  );
}

function InvitationDetails({ credentials }: { credentials: Credentials }) {
  const { token, participantToken, storageKey } = credentials;
  const invitation = useQuery(api.sharing.getInvitation, { token, participantToken });
  const acceptMutation = useMutation(api.sharing.accept);
  const updateMutation = useMutation(api.sharing.updateLocation);
  const stopMutation = useMutation(api.sharing.stop);
  const deleteMutation = useMutation(api.sharing.deleteMine);
  const [declined, setDeclined] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState("");
  const [consented, setConsented] = useState(false);
  const now = useClock();
  const expired = !!invitation && now >= invitation.expiresAt;
  const closed = invitation === null || expired || deleted ||
    invitation?.status === "stopped" || invitation?.status === "revoked";

  const accept = useCallback(async () => {
    if (!invitation) throw new Error("No invitation");
    // Save the separate control secret before binding this browser to the invite.
    window.localStorage.setItem(storageKey, participantToken);
    await acceptMutation({ token, participantToken, consentVersion: invitation.consentVersion });
  }, [invitation, storageKey, token, participantToken, acceptMutation]);
  const sendLocation = useCallback((position: SharedPosition) =>
    updateMutation({ token, participantToken, ...position }), [token, participantToken, updateMutation]);
  const stopRemote = useCallback(() => stopMutation({ token, participantToken }),
    [token, participantToken, stopMutation]);
  const sharing = useLocationSharing({
    expiresAt: invitation?.expiresAt ?? Number.MAX_SAFE_INTEGER,
    closed,
    accept,
    sendLocation,
    stopRemote,
  });

  const deleteData = async () => {
    sharing.endLocally();
    setDeleting(true);
    setDeletionError("");
    try {
      await deleteMutation({ token, participantToken });
      setDeleted(true);
      window.localStorage.removeItem(storageKey);
    } catch {
      setDeletionError("This device has stopped sending locations, but deletion is not confirmed. Your last location may remain visible until deletion succeeds or the link expires. Retry when your connection returns.");
    } finally {
      setDeleting(false);
    }
  };

  if (deleted) return <MessageCard title="Sharing data deleted" message="Location updates have stopped and this sharing session and its data have been deleted from the service." />;
  if (invitation === undefined) return <MessageCard title="Checking the link…" message="Your location has not been requested." />;
  if (invitation === null || expired) return <MessageCard title="This link is unavailable" message="The link has expired, the session was deleted, or the link is invalid. The service no longer accepts locations for this link." />;
  if (declined) return <MessageCard title="You declined this request" message="Your location was not requested or sent. You can close this page." />;

  const live = sharing.phase === "sharing";
  const busy = sharing.phase === "starting";
  const hasControl = invitation.canManage || busy || live || sharing.phase === "paused" || sharing.pendingStop;
  const claimedElsewhere = invitation.status === "active" && !invitation.canManage && !busy;
  const canStart = !closed && !claimedElsewhere && !live && !busy && !sharing.pendingStop && !sharing.stopping && !deleting;
  const resume = invitation.canManage && invitation.status === "active";

  return (
    <Card className="border-zinc-200 bg-white shadow-sm">
      <CardHeader>
        <span className="flex size-11 items-center justify-center rounded-xl bg-zinc-100"><MapPin aria-hidden="true" /></span>
        <CardTitle><h1 className="text-xl leading-8">{closed ? "Location sharing has ended" : "Share your location with consent"}</h1></CardTitle>
        <p className="text-sm leading-7 text-zinc-600">A temporary sharing request. Review the recipient and purpose before you agree.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <div><dt className="text-zinc-600">Account receiving your location</dt><dd className="mt-1 break-words font-semibold">{invitation.recipientName}</dd></div>
          {invitation.recipientEmail && <div><dt className="text-zinc-600">Verified email address</dt><dd className="mt-1 break-all" dir="ltr">{invitation.recipientEmail}</dd></div>}
          <div><dt className="text-zinc-600">Purpose of this request</dt><dd className="mt-1 whitespace-pre-wrap break-words">{invitation.purpose}</dd></div>
          <div><dt className="text-zinc-600">Automatically expires at</dt><dd className="mt-1 font-semibold">{localTime(invitation.expiresAt)} — Remaining <span dir="ltr" className="tabular-nums">{remainingTime(invitation.expiresAt, now)}</span></dd></div>
        </dl>

        <div className="space-y-2 text-sm leading-7 text-zinc-700">
          <p className="flex items-start gap-2"><ShieldCheck aria-hidden="true" className="mt-1 size-4 shrink-0" /><span>This account will see your latest coordinates, their accuracy, and the update time. The account name is shown here; make sure you know who is asking.</span></p>
          <p>We keep only your latest location and delete it when sharing stops, the link is revoked, or it expires. The entire session is deleted at expiry. You can also use Delete my data at any time.</p>
          <p>Updates pause when this page is hidden or closed. Your last location may remain visible until you stop sharing or the link expires. Background tracking is not guaranteed.</p>
        </div>

        {claimedElsewhere && <p role="status" className="rounded-lg border border-zinc-200 p-3 text-sm leading-7">This link is already linked to a participant or another browser. Opening it does not reveal location data. Use the browser that started sharing to manage it.</p>}

        {sharing.message && <p role="status" className={`rounded-lg border p-3 text-sm leading-7 ${live ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-zinc-50"}`}>{sharing.message}</p>}
        {closed && <p role="status" className="text-sm leading-7">{invitation.status === "revoked" ? "The recipient revoked this link." : "Sharing has stopped."} The latest location has been deleted and this link cannot be resumed.</p>}
        {sharing.lastSentAt && <p className="text-xs text-zinc-600">Last confirmed update from this page: {localTime(sharing.lastSentAt)}</p>}
        {deletionError && <p role="alert" className="text-sm leading-7 text-red-700">{deletionError}</p>}

        {canStart && <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-300 p-3 text-sm leading-7">
            <input type="checkbox" className="mt-1.5 size-5 shrink-0 accent-zinc-900" checked={consented} onChange={(event) => setConsented(event.target.checked)} />
            <span>I agree to share my location with the account shown, for the stated purpose, until the link expires or I stop sharing.</span>
          </label>
          <Button className="min-h-12 w-full whitespace-normal" disabled={!consented} onClick={() => void sharing.start()}>
            <MapPin aria-hidden="true" />{resume ? "I agree — resume sharing" : "I agree — start sharing my location"}
          </Button>
          {!hasControl && <Button variant="outline" className="min-h-12 w-full" onClick={() => setDeclined(true)}>Decline</Button>}
        </div>}

        {busy && <p role="status" className="text-sm">Starting sharing… You can stop at any time.</p>}
        {hasControl && <div className="grid gap-3 sm:grid-cols-2">
          {!closed && <Button variant="destructive" className="min-h-12 whitespace-normal" disabled={sharing.stopping || deleting} onClick={() => void sharing.stop()}><Square aria-hidden="true" />{sharing.stopping ? "Confirming stop…" : sharing.pendingStop ? "Retry stopping" : "Stop sharing"}</Button>}
          <Button variant="outline" className="min-h-12 whitespace-normal" disabled={deleting} onClick={() => void deleteData()}><Trash2 aria-hidden="true" />{deleting ? "Confirming deletion…" : "Delete my data"}</Button>
        </div>}
        {hasControl && <p className="text-xs leading-6 text-zinc-600">Return using the same link in this browser to manage sharing. Clearing browser data removes your local control key.</p>}
      </CardContent>
    </Card>
  );
}

function MessageCard({ title, message }: { title: string; message: string }) {
  return <Card className="border-zinc-200 bg-white"><CardHeader><CardTitle><h1 className="text-xl leading-8">{title}</h1></CardTitle></CardHeader><CardContent><p role="status" className="text-sm leading-7 text-zinc-600">{message}</p></CardContent></Card>;
}
