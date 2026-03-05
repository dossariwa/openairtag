"use client";

import { useEffect, useRef, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { cn } from "@/lib/utils";

type MarkerData = {
  id: string;
  longitude: number;
  latitude: number;
  label: string;
  active?: boolean;
};

type MapProps = {
  className?: string;
  mapStyle?: string;
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  showNavigationControl?: boolean;
  accessToken?: string;
  markers?: MarkerData[];
  followTarget?: { longitude: number; latitude: number } | null;
};

const DEFAULT_CENTER: [number, number] = [26.9843685, 49.383363];
const DEFAULT_STYLE = "mapbox://styles/mapbox/streets-v12";

export default function Map({
  className,
  mapStyle = DEFAULT_STYLE,
  center,
  zoom = 9,
  pitch = 0,
  bearing = 0,
  showNavigationControl = true,
  accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  markers = [],
  followTarget = null,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRefs = useRef<globalThis.Map<string, mapboxgl.Marker>>(new globalThis.Map());
  const mapReady = useRef(false);

  const initialCenter = useMemo(() => center ?? DEFAULT_CENTER, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN.");
      return;
    }

    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: initialCenter,
      zoom,
      pitch,
      bearing,
    });

    if (showNavigationControl) {
      map.addControl(new mapboxgl.NavigationControl(), "top-right");
    }

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      mapReady.current = true;
    });

    mapRef.current = map;

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      mapReady.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const existingIds = new Set(markerRefs.current.keys());

      for (const m of markers) {
        const existing = markerRefs.current.get(m.id);

        if (existing) {
          existing.setLngLat([m.longitude, m.latitude]);
          existingIds.delete(m.id);
          continue;
        }

        const el = document.createElement("div");
        el.style.width = "20px";
        el.style.height = "20px";
        el.style.borderRadius = "9999px";
        el.style.backgroundColor = "#ef4444";
        el.style.border = "3px solid #fff";
        el.style.boxShadow = "0 0 0 2px rgba(239,68,68,0.4), 0 2px 8px rgba(0,0,0,0.3)";
        el.title = m.label;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([m.longitude, m.latitude])
          .addTo(map);

        markerRefs.current.set(m.id, marker);
      }

      for (const staleId of existingIds) {
        markerRefs.current.get(staleId)?.remove();
        markerRefs.current.delete(staleId);
      }
    };

    if (mapReady.current) {
      apply();
    } else {
      map.on("load", apply);
    }
  }, [markers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    map.easeTo({ center, duration: 800 });
  }, [center?.[0], center?.[1]]);

  useEffect(() => {
    if (!followTarget || !mapRef.current) return;
    mapRef.current.easeTo({
      center: [followTarget.longitude, followTarget.latitude],
      duration: 900,
    });
  }, [followTarget?.longitude, followTarget?.latitude]);

  return (
    <div
      ref={containerRef}
      className={cn("h-[500px] w-full rounded-lg", className)}
    />
  );
}
