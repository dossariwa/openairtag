import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, useCallback } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

const BG_TASK = "openairtag-bg-location";
const STORAGE_KEY = "openairtag-config";

type Config = {
  serverUrl: string;
  deviceUid: string;
  ingestToken: string;
};

const EMPTY_CONFIG: Config = { serverUrl: "", deviceUid: "", ingestToken: "" };

// ── background task (module-level) ──────────────────────────────────────────

async function postLocation(cfg: Config, loc: Location.LocationObject) {
  if (!cfg.serverUrl || !cfg.deviceUid || !cfg.ingestToken) return;
  const url = cfg.serverUrl.replace(/\/$/, "") + "/gps";
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.ingestToken}`,
    },
    body: JSON.stringify({
      deviceUid: cfg.deviceUid,
      ingestToken: cfg.ingestToken,
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
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const cfg: Config = raw ? JSON.parse(raw) : EMPTY_CONFIG;
  for (const loc of locs) {
    await postLocation(cfg, loc);
  }
});

// ── main screen ─────────────────────────────────────────────────────────────

export default function TrackerScreen() {
  const [config, setConfig] = useState<Config>(EMPTY_CONFIG);
  const [bgEnabled, setBgEnabled] = useState(false);
  const [status, setStatus] = useState("Idle");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) setConfig(JSON.parse(raw));
    });
  }, []);

  const saveConfig = useCallback(
    (next: Config) => {
      setConfig(next);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    [],
  );

  const requestPerms = useCallback(async () => {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      Alert.alert("Permission required", "Foreground location is needed.");
      return false;
    }
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) {
      Alert.alert("Background limited", "Background permission is recommended for continuous tracking.");
    }
    return true;
  }, []);

  const sendNow = useCallback(async () => {
    if (!config.serverUrl || !config.deviceUid || !config.ingestToken) {
      Alert.alert("Missing config", "Fill in all fields first.");
      return;
    }
    if (!(await requestPerms())) return;
    setStatus("Getting location...");
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await postLocation(config, loc);
    setStatus(`Sent at ${new Date().toLocaleTimeString()}`);
  }, [config, requestPerms]);

  const toggleBg = useCallback(
    async (on: boolean) => {
      if (!on) {
        const running = await TaskManager.isTaskRegisteredAsync(BG_TASK);
        if (running) await Location.stopLocationUpdatesAsync(BG_TASK);
        setBgEnabled(false);
        setStatus("Background stopped.");
        return;
      }
      if (!config.serverUrl || !config.deviceUid || !config.ingestToken) {
        Alert.alert("Missing config", "Fill in all fields first.");
        return;
      }
      if (!(await requestPerms())) return;
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
      setBgEnabled(true);
      setStatus("Background tracking active.");
    },
    [config, requestPerms],
  );

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>OpenAirTag Tracker</Text>
        <Text style={s.subtitle}>Enter your dashboard server details below.</Text>

        <Text style={s.label}>Server URL</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://your-site.vercel.app"
          placeholderTextColor="#a1a1aa"
          value={config.serverUrl}
          onChangeText={(v) => saveConfig({ ...config, serverUrl: v })}
        />

        <Text style={s.label}>Device UID</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="dev_xxx"
          placeholderTextColor="#a1a1aa"
          value={config.deviceUid}
          onChangeText={(v) => saveConfig({ ...config, deviceUid: v })}
        />

        <Text style={s.label}>Ingest Token</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="ing_xxx"
          placeholderTextColor="#a1a1aa"
          value={config.ingestToken}
          onChangeText={(v) => saveConfig({ ...config, ingestToken: v })}
        />

        <Pressable style={s.btn} onPress={sendNow}>
          <Text style={s.btnText}>Send Now</Text>
        </Pressable>

        <View style={s.row}>
          <Text style={s.label}>Background tracking</Text>
          <Switch value={bgEnabled} onValueChange={toggleBg} />
        </View>

        <View style={s.statusBox}>
          <Text style={s.statusText}>{status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 20, paddingTop: 60, gap: 12 },
  title: { fontSize: 26, fontWeight: "800", color: "#18181b" },
  subtitle: { fontSize: 14, color: "#71717a", marginBottom: 4 },
  label: { fontSize: 13, fontWeight: "600", color: "#3f3f46" },
  input: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#18181b",
    backgroundColor: "#fafafa",
  },
  btn: {
    backgroundColor: "#18181b",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  statusBox: {
    marginTop: 8,
    backgroundColor: "#f4f4f5",
    borderRadius: 10,
    padding: 14,
  },
  statusText: { fontSize: 13, color: "#52525b" },
});
