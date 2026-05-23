import { useCallback, useEffect, useRef, useState } from "react";
import { storage, STORAGE_KEYS } from "./storage";

// Discovery options derived from user settings (gate DLNA SSDP if disabled).
const discoveryOpts = () => ({
  enableDlna: storage.get(STORAGE_KEYS.CAST_ENABLE_DLNA) ?? true,
});

/**
 * Casting state + control hook. Subscribes to main-process cast IPC.
 *
 * Discovery is on-demand: nothing scans the network until `startDiscovery()`
 * is called (the picker / settings do this when opened). The active session's
 * device is tracked independently of the live discovery list, so the overlay
 * and controls keep working even while discovery is stopped.
 *
 * Returns:
 *   devices              Device[]
 *   isDiscovering        bool
 *   currentDevice        Device | null  (the connected device; survives discovery off)
 *   sessionState         "idle"|"connecting"|"buffering"|"playing"|"paused"|"ended"|"error"
 *   position, duration   seconds
 *   volume, muted        0..1, bool
 *   lastError            string | null
 *
 * Actions: startDiscovery, stopDiscovery, connect, disconnect,
 *          load, play, pause, stop, seek, setVolume, setMute, setSubtitleTrack
 */
export function useCast({ autoDiscover = false } = {}) {
  const [devices, setDevices] = useState([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  // The connected device object — set on connect, cleared on session end.
  // Independent of `devices` so it survives discovery being stopped.
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [sessionState, setSessionState] = useState("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [lastError, setLastError] = useState(null);

  const mountedRef = useRef(true);
  const devicesRef = useRef([]);
  devicesRef.current = devices;
  const discoverTimerRef = useRef(null);

  // Discovery is fire-and-forget in the main process: cast:start-discovery
  // resolves immediately while mDNS/SSDP responses trickle in over the next few
  // seconds. Keep `isDiscovering` true for that window so the UI shows
  // "Scanning…" instead of flashing "No devices found".
  const DISCOVER_WINDOW_MS = 5000;
  const runDiscovery = () => {
    if (!window.electron?.castStartDiscovery) return;
    setIsDiscovering(true);
    if (discoverTimerRef.current) clearTimeout(discoverTimerRef.current);
    Promise.resolve(window.electron.castStartDiscovery(discoveryOpts())).catch(
      () => {},
    );
    discoverTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setIsDiscovering(false);
    }, DISCOVER_WINDOW_MS);
  };

  // Subscribe to push events from main
  useEffect(() => {
    if (!window.electron) return;
    mountedRef.current = true;

    const devH = window.electron.onCastDevicesUpdated?.((list) => {
      if (!mountedRef.current) return;
      setDevices(Array.isArray(list) ? list : []);
    });
    const statusH = window.electron.onCastStatus?.((s) => {
      if (!mountedRef.current || !s) return;
      setSessionState(s.sessionState || "idle");
      if (Number.isFinite(s.currentTime)) setPosition(s.currentTime);
      if (Number.isFinite(s.duration) && s.duration > 0) setDuration(s.duration);
      if (Number.isFinite(s.volume)) setVolume(s.volume);
      if (typeof s.muted === "boolean") setMuted(s.muted);
    });
    const endedH = window.electron.onCastSessionEnded?.(() => {
      if (!mountedRef.current) return;
      setSessionState("idle");
      setConnectedDevice(null);
      setPosition(0);
      setDuration(0);
    });
    const errH = window.electron.onCastError?.((e) => {
      if (!mountedRef.current) return;
      setLastError(e?.message || "Cast error");
    });

    if (autoDiscover) runDiscovery();

    return () => {
      mountedRef.current = false;
      if (discoverTimerRef.current) clearTimeout(discoverTimerRef.current);
      if (devH) window.electron.offCastDevicesUpdated?.(devH);
      if (statusH) window.electron.offCastStatus?.(statusH);
      if (endedH) window.electron.offCastSessionEnded?.(endedH);
      if (errH) window.electron.offCastError?.(errH);
    };
  }, [autoDiscover]);

  // Periodic status pull while connected (fallback for dropped push events)
  useEffect(() => {
    if (sessionState === "idle") return;
    const t = setInterval(async () => {
      try {
        const s = await window.electron?.castGetStatus?.();
        if (!mountedRef.current || !s) return;
        if (Number.isFinite(s.currentTime)) setPosition(s.currentTime);
        if (Number.isFinite(s.duration) && s.duration > 0) setDuration(s.duration);
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [sessionState]);

  const currentDevice = connectedDevice;

  const startDiscovery = useCallback(() => {
    runDiscovery();
  }, []);

  const stopDiscovery = useCallback(async () => {
    await window.electron?.castStopDiscovery?.();
  }, []);

  const connect = useCallback(async (deviceId) => {
    setLastError(null);
    setSessionState("connecting");
    const device =
      devicesRef.current.find((d) => d.id === deviceId) ||
      { id: deviceId, name: deviceId, type: "cast" };
    setConnectedDevice(device);
    const r = await window.electron?.castConnect?.(deviceId);
    if (!r?.ok) {
      setSessionState("idle");
      setConnectedDevice(null);
      setLastError(r?.error || "Connect failed");
    }
    return r;
  }, []);

  const disconnect = useCallback(async () => {
    const r = await window.electron?.castDisconnect?.();
    setSessionState("idle");
    setConnectedDevice(null);
    setPosition(0);
    setDuration(0);
    return r;
  }, []);

  const load = useCallback(async (args) => {
    setLastError(null);
    const r = await window.electron?.castLoad?.(args);
    if (!r?.ok) setLastError(r?.error || "Load failed");
    return r;
  }, []);

  const play = useCallback(() => window.electron?.castPlay?.(), []);
  const pause = useCallback(() => window.electron?.castPause?.(), []);
  const stop = useCallback(() => window.electron?.castStop?.(), []);
  const seek = useCallback(
    (sec) => window.electron?.castSeek?.(Number(sec) || 0),
    [],
  );
  const setCastVolume = useCallback(
    (lvl) => window.electron?.castSetVolume?.(Math.max(0, Math.min(1, Number(lvl) || 0))),
    [],
  );
  const setCastMute = useCallback(
    (m) => window.electron?.castSetMute?.(!!m),
    [],
  );
  const setSubtitleTrack = useCallback(
    (trackIndex) =>
      window.electron?.castSetSubtitleTrack?.(
        trackIndex == null ? null : Number(trackIndex),
      ),
    [],
  );

  return {
    devices,
    isDiscovering,
    currentDevice,
    sessionState,
    position,
    duration,
    volume,
    muted,
    lastError,
    startDiscovery,
    stopDiscovery,
    connect,
    disconnect,
    load,
    play,
    pause,
    stop,
    seek,
    setVolume: setCastVolume,
    setMute: setCastMute,
    setSubtitleTrack,
  };
}
