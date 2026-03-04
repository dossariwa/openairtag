"use client";

import { useEffect, useState } from "react";
import { Smartphone, Monitor, Apple } from "lucide-react";

type DetectedPlatform = "ios" | "android" | "desktop";

function detectPlatform(): DetectedPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export default function OnboardingPage() {
  const [platform, setPlatform] = useState<DetectedPlatform>("desktop");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-5xl font-extrabold tracking-tight text-zinc-900">
          OpenAirTag
        </h1>
        <p className="mt-3 text-zinc-500">
          Track your devices in real time.
        </p>

        {/* Logo placeholder */}
        <div className="mx-auto mt-8 flex h-24 w-24 items-center justify-center rounded-2xl bg-zinc-900 text-white">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-12 w-12"
          >
            <circle cx="12" cy="10" r="3" />
            <path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 12 8 12s8-6.6 8-12a8 8 0 0 0-8-8z" />
          </svg>
        </div>

        {/* QR Code */}
        <div className="mx-auto mt-10 flex h-48 w-48 items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-white">
          <span className="text-xs text-zinc-400">QR Code</span>
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          Scan to install the tracker app
        </p>

        {/* Divider */}
        <div className="mt-8 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            or install manually
          </span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        {/* Platform cards */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <PlatformCard
            icon={<Apple className="h-6 w-6" />}
            label="iOS"
            href="#"
            highlighted={platform === "ios"}
          />
          <PlatformCard
            icon={<Smartphone className="h-6 w-6" />}
            label="Android"
            href="#"
            highlighted={platform === "android"}
          />
          <PlatformCard
            icon={<Monitor className="h-6 w-6" />}
            label="PC / Laptop"
            href="#"
            highlighted={platform === "desktop"}
          />
        </div>

        {platform !== "desktop" && (
          <p className="mt-4 text-xs text-zinc-400">
            We detected you&apos;re on{" "}
            <span className="font-semibold text-zinc-600">
              {platform === "ios" ? "iOS" : "Android"}
            </span>
            .
          </p>
        )}

        {/* Dashboard link */}
        <a
          href="/dashboard"
          className="mt-10 inline-block rounded-lg bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Open Dashboard
        </a>
      </div>
    </div>
  );
}

function PlatformCard({
  icon,
  label,
  href,
  highlighted,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  highlighted: boolean;
}) {
  return (
    <a
      href={href}
      className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition ${
        highlighted
          ? "border-zinc-900 bg-zinc-900 text-white shadow-lg"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
      }`}
    >
      {icon}
      <span className="text-xs font-semibold">{label}</span>
    </a>
  );
}
