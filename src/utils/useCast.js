import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Casting state + control hook. Subscribes to main-process cast IPC.
 *
 * Returns:
 *   devices              Device[]
 *   isDiscovering        bool
 *   currentDevice        Device | null
 *   sessionState         "idle"|"connecting"|"buffering"|"playing"|"paused"|"ended"|"error"
 *   position, duration   seconds
 *   volume, muted        0..1, bool
 *   lastError            string | null
 *
 * Actions: startDiscovery, stopDiscovery, connect, disconnect,
 *          load, play, pause, stop, seek, setVolume, setMute
 */
export function useCast({ autoDiscover = true } = {}) {
  const [devices, setDevices] = useState([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState(null);
  const [sessionState, setSessionState] = useState("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [lastError, setLastError] = useState(null);

  const mountedRef = useRef(true);

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
      if (s.deviceId) setCurrentDeviceId(s.deviceId);
    });
    const endedH = window.electron.onCastSessionEnded?.(() => {
      if (!mountedRef.current) return;
      setSessionState("idle");
      setCurrentDeviceId(null);
      setPosition(0);
      setDuration(0);
    });
    const errH = window.electron.onCastError?.((e) => {
      if (!mountedRef.current) return;
      setLastError(e?.message || "Cast error");
    });

    // Prime device list
    window.electron.castListDevices?.().then((list) => {
      if (mountedRef.current && Array.isArray(list)) setDevices(list);
    });

    if (autoDiscover) {
      setIsDiscovering(true);
      window.electron.castStartDiscovery?.().finally(() => {
        if (mountedRef.current) setIsDiscovering(false);
      });
    }

    return () => {
      mountedRef.current = false;
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

  const currentDevice =
    devices.find((d) => d.id === currentDeviceId) || null;

  const startDiscovery = useCallback(async () => {
    setIsDiscovering(true);
    try {
      await window.electron?.castStartDiscovery?.();
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  const stopDiscovery = useCallback(async () => {
    await window.electron?.castStopDiscovery?.();
  }, []);

  const connect = useCallback(async (deviceId) => {
    setLastError(null);
    setSessionState("connecting");
    const r = await window.electron?.castConnect?.(deviceId);
    if (r?.ok) setCurrentDeviceId(deviceId);
    else {
      setSessionState("idle");
      setLastError(r?.error || "Connect failed");
    }
    return r;
  }, []);

  const disconnect = useCallback(async () => {
    const r = await window.electron?.castDisconnect?.();
    setSessionState("idle");
    setCurrentDeviceId(null);
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
