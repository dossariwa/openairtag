import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useEffect, useState, useCallback, useRef } from "react";
import { Alert, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

const SERVER_URL = "https://openairtag.vercel.app";
const BG_TASK = "openairtag-bg-location";
const DEVICE_KEY = "openairtag-device";

type DeviceIdentity = { deviceUid: string; ingestToken: string };

function generateUid() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getDeviceName(): string {
  const name = Constants.deviceName;
  if (name) return name;
  return Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "Android" : "Device";
}

function detectPlatform(): "ios" | "android" | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "unknown";
}

async function getOrCreateIdentity(): Promise<DeviceIdentity> {
  const raw = await AsyncStorage.getItem(DEVICE_KEY);
  if (raw) return JSON.parse(raw);
  const identity: DeviceIdentity = {
    deviceUid: `dev_${generateUid()}`,
    ingestToken: `ing_${generateUid()}`,
  };
  await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(identity));
  return identity;
}

async function postLocation(identity: DeviceIdentity, loc: Location.LocationObject) {
  await fetch(`${SERVER_URL}/gps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceUid: identity.deviceUid,
      ingestToken: identity.ingestToken,
      deviceName: getDeviceName(),
      platform: detectPlatform(),
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? undefined,
      speed: loc.coords.speed ?? undefined,
      heading: loc.coords.heading ?? undefined,
      timestamp: loc.timestamp,
    }),
  }).catch(() => {});
}

TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
  if (error) return;
  const locs = (data as { locations?: Location.LocationObject[] })?.locations;
  if (!locs?.length) return;
  const identity = await getOrCreateIdentity();
  for (const loc of locs) {
    await postLocation(identity, loc);
  }
});

async function startBackgroundTracking(): Promise<boolean> {
  try {
    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15_000,
      distanceInterval: 20,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "OpenAirTag",
        notificationBody: "Tracking active",
      },
    });
    return true;
  } catch {
    return false;
  }
}

export default function TrackerScreen() {
  const [granted, setGranted] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState("");
  const fgInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const fg = await Location.getForegroundPermissionsAsync();
        if (fg.granted) {
          setGranted(true);
          try {
            const running = await TaskManager.isTaskRegisteredAsync(BG_TASK);
            if (running) {
              setTracking(true);
              setStatus("Background tracking active");
              return;
            }
          } catch {}
          startForegroundPolling();
          setTracking(true);
          setStatus("Foreground tracking active");
        }
      } catch {}
    })();
    return () => {
      if (fgInterval.current) clearInterval(fgInterval.current);
    };
  }, []);

  const startForegroundPolling = useCallback(() => {
    if (fgInterval.current) return;
    fgInterval.current = setInterval(async () => {
      try {
        const identity = await getOrCreateIdentity();
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await postLocation(identity, loc);
      } catch {}
    }, 15_000);
  }, []);

  const handleAllow = useCallback(async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (!fg.granted) {
        setStatus("Location permission denied.");
        return;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("NSLocation")) {
        Alert.alert(
          "Development Build Required",
          "Background location on iOS requires a development build, not Expo Go. Foreground tracking will still work.",
        );
      } else {
        setStatus(`Permission error: ${msg}`);
        return;
      }
    }

    setGranted(true);
    setStatus("Getting location...");

    try {
      const identity = await getOrCreateIdentity();
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await postLocation(identity, loc);
      setStatus("Location sent!");
    } catch (e: unknown) {
      setStatus(`Location error: ${e instanceof Error ? e.message : String(e)}`);
    }

    let bgStarted = false;
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.granted) {
        bgStarted = await startBackgroundTracking();
      }
    } catch {}

    if (bgStarted) {
      setTracking(true);
      setStatus("Background tracking active");
    } else {
      startForegroundPolling();
      setTracking(true);
      setStatus("Foreground tracking active (background unavailable)");
    }
  }, [startForegroundPolling]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.center}>
          <Text style={s.title}>OpenAirTag</Text>

          {!granted ? (
            <Pressable style={s.btn} onPress={handleAllow}>
              <Text style={s.btnText}>Allow</Text>
            </Pressable>
          ) : (
            <View style={s.statusPill}>
              <View style={[s.dot, tracking ? s.dotActive : s.dotInactive]} />
              <Text style={s.statusLabel}>
                {tracking ? "Tracking" : "Inactive"}
              </Text>
            </View>
          )}

          {status !== "" && <Text style={s.statusText}>{status}</Text>}
        </View>

        <Text style={s.footer}>OpenAirTag @ 2026</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, justifyContent: "space-between", alignItems: "center", paddingVertical: 60 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 20 },
  title: { fontSize: 36, fontWeight: "900", color: "#18181b", letterSpacing: -1 },
  btn: {
    backgroundColor: "#18181b",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 48,
  },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f4f4f5",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotActive: { backgroundColor: "#22c55e" },
  dotInactive: { backgroundColor: "#a1a1aa" },
  statusLabel: { fontSize: 15, fontWeight: "600", color: "#3f3f46" },
  statusText: { fontSize: 13, color: "#71717a", textAlign: "center", paddingHorizontal: 30 },
  footer: { fontSize: 12, color: "#a1a1aa" },
});
