"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Map from "@/components/map";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useState, useCallback } from "react";

export default function DeviceDetailPage() {
  const { deviceUid } = useParams<{ deviceUid: string }>();
  const device = useQuery(api.locations.getDevice, { deviceUid });
  const history = useQuery(api.locations.getDeviceHistory, { deviceUid, limit: 30 });
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (device === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-400">Loading device...</p>
      </div>
    );
  }

  if (device === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50">
        <p className="text-sm text-zinc-500">Device not found.</p>
        <Link href="/dashboard" className="text-sm text-zinc-900 underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const loc = device.latestLocation;
  const markers = loc
    ? [
        {
          id: device.deviceUid,
          longitude: loc.longitude,
          latitude: loc.latitude,
          label: device.deviceName,
          active: true,
        },
      ]
    : [];

  const center: [number, number] | undefined = loc
    ? [loc.longitude, loc.latitude]
    : undefined;

  return (
    <div className="min-h-screen bg-zinc-50" key={refreshKey}>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <Link
            href="/dashboard"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-zinc-900">{device.deviceName}</h1>
            <p className="text-xs text-zinc-500 uppercase">{device.platform}</p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Device info */}
        <div className="grid gap-3 sm:grid-cols-4">
          <InfoCard label="Status" value={device.trackingEnabled ? "Tracking" : "Disabled"} />
          <InfoCard
            label="Last Seen"
            value={device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"}
          />
          <InfoCard
            label="Latitude"
            value={loc ? loc.latitude.toFixed(6) : "--"}
          />
          <InfoCard
            label="Longitude"
            value={loc ? loc.longitude.toFixed(6) : "--"}
          />
        </div>

        {/* Map */}
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-3">
          {loc ? (
            <Map
              className="h-[55vh]"
              zoom={14}
              center={center}
              markers={markers}
            />
          ) : (
            <div className="flex h-[55vh] items-center justify-center text-sm text-zinc-400">
              No location data available yet.
            </div>
          )}
        </div>

        {/* History */}
        {history && history.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-zinc-700">Recent History</h2>
            <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-100 bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Lat</th>
                    <th className="px-4 py-2 font-medium">Lng</th>
                    <th className="px-4 py-2 font-medium">Accuracy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {history.map((h) => (
                    <tr key={h._id}>
                      <td className="px-4 py-2 text-zinc-600">
                        {new Date(h.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-zinc-700">{h.latitude.toFixed(6)}</td>
                      <td className="px-4 py-2 text-zinc-700">{h.longitude.toFixed(6)}</td>
                      <td className="px-4 py-2 text-zinc-500">
                        {h.accuracy != null ? `${h.accuracy.toFixed(0)}m` : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}
