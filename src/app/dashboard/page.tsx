"use client";

import { useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { MapPin, Smartphone, MoreVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function DashboardPage() {
  const devices = useQuery(api.locations.listDevices);
  const deleteDevice = useMutation(api.locations.deleteDevice);
  const knownUids = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!devices) return;

    if (knownUids.current === null) {
      knownUids.current = new Set(devices.map((d) => d.deviceUid));
      return;
    }

    for (const device of devices) {
      if (!knownUids.current.has(device.deviceUid)) {
        knownUids.current.add(device.deviceUid);
        toast.success("New device", {
          description: `${device.deviceName} (${device.platform}) is now being tracked.`,
        });
      }
    }
  }, [devices]);

  const handleDelete = useCallback(
    async (deviceUid: string, deviceName: string) => {
      try {
        await deleteDevice({ deviceUid });
        knownUids.current?.delete(deviceUid);
        toast.success("Device deleted", {
          description: `${deviceName} has been removed.`,
        });
      } catch {
        toast.error("Failed to delete device");
      }
    },
    [deleteDevice],
  );

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-zinc-900">OpenAirTag Dashboard</h1>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
            Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="text-lg font-semibold text-zinc-800">Tracked Devices</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Devices with installed GPS trackers appear here in real time.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {devices === undefined && (
            <p className="col-span-full text-sm text-zinc-400">Loading...</p>
          )}
          {devices?.length === 0 && (
            <p className="col-span-full text-sm text-zinc-400">No devices yet.</p>
          )}

          {devices?.map((device) => (
            <div
              key={device.deviceUid}
              className="group relative flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 hover:shadow-sm"
            >
              <Link
                href={`/dashboard/${device.deviceUid}`}
                className="absolute inset-0 z-0 rounded-xl"
              />

              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 group-hover:bg-zinc-900 group-hover:text-white">
                <Smartphone className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-zinc-900">{device.deviceName}</p>
                <p className="text-xs text-zinc-500 uppercase">{device.platform}</p>
                {device.latestLocation ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
                    <MapPin className="h-3 w-3" />
                    {device.latestLocation.latitude.toFixed(5)},{" "}
                    {device.latestLocation.longitude.toFixed(5)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-zinc-400">No location yet</p>
                )}
                <p className="mt-0.5 text-xs text-zinc-400">
                  Last seen:{" "}
                  {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"}
                </p>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                    onClick={(e) => e.preventDefault()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onClick={() => handleDelete(device.deviceUid, device.deviceName)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete device
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
