"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SharedPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

type Phase = "idle" | "starting" | "sharing" | "paused" | "ended" | "error";

type Options = {
  expiresAt: number;
  closed: boolean;
  accept: () => Promise<unknown>;
  sendLocation: (position: SharedPosition) => Promise<{ accepted: boolean }>;
  stopRemote: () => Promise<unknown>;
};

// The watcher only starts from start(), which the UI invokes on an explicit click.
// A generation counter also rejects already queued callbacks after cancellation.
export function useLocationSharing({ expiresAt, closed, accept, sendLocation, stopRemote }: Options) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [pendingStop, setPendingStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const watcher = useRef<number | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const sending = useRef(false);
  const lastSubmission = useRef(0);
  const current = useRef({ expiresAt, closed, accept, sendLocation, stopRemote });

  useEffect(() => {
    current.current = { expiresAt, closed, accept, sendLocation, stopRemote };
  }, [expiresAt, closed, accept, sendLocation, stopRemote]);

  const clearWatcher = useCallback(() => {
    generation.current += 1;
    if (watcher.current !== null) {
      navigator.geolocation.clearWatch(watcher.current);
      watcher.current = null;
    }
  }, []);

  const endLocally = useCallback(() => {
    clearWatcher();
    if (alive.current) setPhase("ended");
  }, [clearWatcher]);

  const stop = useCallback(async () => {
    clearWatcher();
    if (alive.current) {
      setPhase("ended");
      setStopping(true);
      setMessage("This device has stopped sending locations. Confirming deletion of the latest location…");
    }
    try {
      await current.current.stopRemote();
      if (alive.current) {
        setPendingStop(false);
        setMessage("Sharing has stopped and the latest location has been deleted from the service.");
      }
    } catch {
      if (alive.current) {
        setPendingStop(true);
        setMessage("This device has stopped sending locations, but the server has not confirmed the stop. Your last location may remain visible until the stop is confirmed or the link expires. Retry when your connection returns.");
      }
    } finally {
      if (alive.current) setStopping(false);
    }
  }, [clearWatcher]);

  const start = useCallback(async () => {
    if (current.current.closed || Date.now() >= current.current.expiresAt) {
      endLocally();
      return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setPhase("error");
      setMessage("Use a browser with location support over a secure HTTPS connection. No location has been shared.");
      return;
    }
    if (document.hidden || !navigator.onLine) {
      setPhase("paused");
      setMessage("Keep this page visible and connect to the internet, then select start sharing.");
      return;
    }
    clearWatcher();
    const run = generation.current;
    const valid = () => alive.current && generation.current === run &&
      !current.current.closed && Date.now() < current.current.expiresAt && !document.hidden;
    setPhase("starting");
    setMessage("Recording your consent. Your browser will ask for location permission if needed.");
    try {
      await current.current.accept();
      if (!valid()) return;
      setPhase("sharing");
      setMessage("Waiting for your device's location. Keep this page open for updates.");
      lastSubmission.current = 0;
      watcher.current = navigator.geolocation.watchPosition(
        async (position) => {
          if (!valid() || sending.current || !navigator.onLine) return;
          if (lastSubmission.current && Date.now() - lastSubmission.current < 5_000) return;
          sending.current = true;
          lastSubmission.current = Date.now();
          try {
            const result = await current.current.sendLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp,
            });
            if (valid() && result.accepted) {
              setLastSentAt(Date.now());
              setMessage("You are sharing your location while this page remains visible.");
            }
          } catch {
            if (valid()) {
              clearWatcher();
              setPhase("error");
              setMessage("Could not send your location. Location collection has stopped; trying to end the session.");
              void stop();
            }
          } finally {
            sending.current = false;
          }
        },
        (error) => {
          if (!valid()) return;
          clearWatcher();
          const reason = error.code === 1
            ? "Location permission was denied."
            : error.code === 3
              ? "The location request timed out."
              : "This device could not determine its location.";
          setPhase("error");
          // Final stop prevents a later browser callback from resuming this session.
          void stop().then(() => {
            if (alive.current) setMessage((result) => `${reason} ${result}`);
          });
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
    } catch {
      if (valid()) {
        clearWatcher();
        setPhase("error");
        setMessage("Consent could not be confirmed. Location collection has not started. Check your connection and the link's expiry.");
      }
    }
  }, [clearWatcher, endLocally, stop]);

  useEffect(() => {
    alive.current = true;
    const pause = () => {
      if (watcher.current === null && phase !== "starting") return;
      clearWatcher();
      setPhase("paused");
      setMessage("Location updates are paused. The recipient may still see your last location until you stop sharing or the link expires. Select resume sharing to continue.");
    };
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", pause);
    window.addEventListener("pagehide", pause);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", pause);
      window.removeEventListener("pagehide", pause);
    };
  }, [clearWatcher, phase]);

  useEffect(() => {
    if (closed) {
      clearWatcher();
      return;
    }
    if (expiresAt === Number.MAX_SAFE_INTEGER) return;
    const timer = window.setTimeout(() => {
      endLocally();
      setMessage("This sharing session has expired. Location updates have stopped.");
    }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [closed, expiresAt, clearWatcher, endLocally]);

  useEffect(() => () => {
    alive.current = false;
    clearWatcher();
  }, [clearWatcher]);

  return { phase, message, lastSentAt, pendingStop, stopping, start, stop, endLocally };
}
