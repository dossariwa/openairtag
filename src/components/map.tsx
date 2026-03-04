"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { cn } from "@/lib/utils";

type MapProps = {
  className?: string;
  mapStyle?: string;
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  showNavigationControl?: boolean;
  accessToken?: string;
  markers?: Array<{
    id: string;
    longitude: number;
    latitude: number;
    label: string;
    active?: boolean;
  }>;
  followTarget?: {
    longitude: number;
    latitude: number;
  } | null;
};

const DEFAULT_CENTER: [number, number] = [26.9843685, 49.383363];
const DEFAULT_STYLE = "mapbox://styles/mapbox/streets-v12";

export default function Map({
  className,
  mapStyle = DEFAULT_STYLE,
  center = DEFAULT_CENTER,
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN for Mapbox map.");
      return;
    }

    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapStyle,
      center,
      zoom,
      pitch,
      bearing,
    });

    if (showNavigationControl) {
      map.addControl(new mapboxgl.NavigationControl(), "top-right");
    }

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [accessToken, bearing, center, mapStyle, pitch, showNavigationControl, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existingIds = new Set(markerRefs.current.keys());

    for (const marker of markers) {
      const existing = markerRefs.current.get(marker.id);
      const color = marker.active ? "#ef4444" : "#111827";

      if (existing) {
        existing.setLngLat([marker.longitude, marker.latitude]);
        const element = existing.getElement();
        element.style.backgroundColor = color;
        existingIds.delete(marker.id);
        continue;
      }

      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "9999px";
      el.style.backgroundColor = color;
      el.style.border = "2px solid #fff";
      el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.15)";
      el.title = marker.label;

      const mapMarker = new mapboxgl.Marker({ element: el })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(map);

      markerRefs.current.set(marker.id, mapMarker);
    }

    for (const staleId of existingIds) {
      markerRefs.current.get(staleId)?.remove();
      markerRefs.current.delete(staleId);
    }
  }, [markers]);

  useEffect(() => {
    if (!followTarget || !mapRef.current) return;
    mapRef.current.easeTo({
      center: [followTarget.longitude, followTarget.latitude],
      duration: 900,
    });
  }, [followTarget]);

  return (
    <div
      ref={containerRef}
      className={cn("h-[500px] w-full rounded-lg", className)}
    />
  );
}
