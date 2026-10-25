import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import { MEDIA_POLICY } from "./preparation";

export type PlaybackState = "loading" | "ready" | "buffering" | "error";

export function CardVideo({
  uri,
  active,
  foreground,
  muted,
  loop,
  style,
  retryToken,
  onReady,
  onState,
  onProgress,
  onFinish,
  attached = true,
  onPlayer,
}: {
  uri: string;
  active: boolean;
  foreground: boolean;
  muted: boolean;
  loop: boolean;
  style: StyleProp<ViewStyle>;
  retryToken: number;
  onReady: () => void;
  onState: (state: PlaybackState) => void;
  onProgress: (time: number, duration: number) => void;
  onFinish: () => void;
  attached?: boolean;
  onPlayer?: (player: VideoPlayer | null) => void;
}) {
  const [state, setState] = useState<PlaybackState>("loading");
  const callbacks = useRef({ active, onReady, onProgress, onFinish });
  const retries = useRef(0);
  const lastTime = useRef(0);
  const restoring = useRef(false);
  const reloading = useRef(false);
  const mounted = useRef(true);
  const player = useVideoPlayer({ uri, useCaching: true }, (instance) => {
    instance.muted = true;
    instance.timeUpdateEventInterval = 0.1;
  });
  const playerCallback = useRef(onPlayer);
  playerCallback.current = onPlayer;
  useLayoutEffect(() => {
    playerCallback.current?.(player);
    return () => playerCallback.current?.(null);
  }, [player]);
  useLayoutEffect(() => {
    callbacks.current = { active, onReady, onProgress, onFinish };
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  useEffect(() => {
    player.bufferOptions = {
      preferredForwardBufferDuration: foreground
        ? MEDIA_POLICY.activeBufferSeconds
        : MEDIA_POLICY.warmBufferSeconds,
      minBufferForPlayback: 1.5,
      maxBufferBytes: foreground
        ? MEDIA_POLICY.activeBufferBytes
        : MEDIA_POLICY.warmBufferBytes,
      prioritizeTimeOverSizeThreshold: false,
      waitsToMinimizeStalling: true,
    };
    player.muted = muted;
    player.loop = loop;
  }, [foreground, muted, loop, player]);
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  useEffect(() => {
    const reportStatus = () => {
      if (player.status === "error") setState("error");
      else if (player.status === "readyToPlay") {
        if (restoring.current) {
          player.currentTime = lastTime.current;
          restoring.current = false;
        }
        setState("ready");
      } else setState(lastTime.current > 0 ? "buffering" : "loading");
    };
    const status = player.addListener("statusChange", reportStatus);
    const time = player.addListener("timeUpdate", (event) => {
      if (
        !callbacks.current.active ||
        player.status !== "readyToPlay" ||
        restoring.current
      )
        return;
      lastTime.current = event.currentTime;
      callbacks.current.onProgress(event.currentTime, player.duration);
    });
    const end = player.addListener("playToEnd", () => {
      if (callbacks.current.active) callbacks.current.onFinish();
    });
    reportStatus();
    return () => {
      status.remove();
      time.remove();
      end.remove();
    };
  }, [player]);

  async function reload() {
    if (reloading.current || !mounted.current) return;
    reloading.current = true;
    setState("loading");
    restoring.current = true;
    try {
      await player.replaceAsync({ uri, useCaching: true });
      if (!mounted.current) return;
      if (player.status === "readyToPlay" && restoring.current) {
        player.currentTime = lastTime.current;
        restoring.current = false;
      }
      if (callbacks.current.active) player.play();
    } catch {
      if (mounted.current) setState("error");
    } finally {
      reloading.current = false;
    }
  }
  useEffect(() => {
    if (!active || state !== "error" || retries.current >= 2) return;
    const delay = retries.current === 0 ? 1500 : 4000;
    const timer = setTimeout(() => {
      retries.current += 1;
      void reload();
    }, delay);
    return () => clearTimeout(timer);
  }, [active, state]);
  useEffect(() => {
    if (retryToken === 0) return;
    retries.current = 0;
    void reload();
  }, [retryToken]);

  if (!attached) return null;
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      surfaceType="textureView"
      nativeControls={false}
      onFirstFrameRender={() => callbacks.current.onReady()}
    />
  );
}
