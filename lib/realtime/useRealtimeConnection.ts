"use client";

import { useCallback, useRef, useState } from "react";
import type { ConnectionState, RealtimeConnectionOptions } from "./types";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const REALTIME_MODEL = "gpt-realtime";

export function useRealtimeConnection(options: RealtimeConnectionOptions = {}) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const transceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const [state, setState] = useState<ConnectionState>("idle");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const updateState = useCallback((s: ConnectionState) => {
    setState(s);
    optionsRef.current.onStateChange?.(s);
  }, []);

  const connect = useCallback(
    async (personaId: string) => {
      try {
        updateState("connecting");

        const res = await fetch("/api/realtime-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? `Session error: ${res.status}`);
        }
        const { token } = await res.json();

        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        pc.ontrack = (event) => {
          optionsRef.current.onTrack?.(event);
        };

        // Data channel for sending client events (e.g. response.create after PTT)
        const dc = pc.createDataChannel("oai-events", { ordered: true });
        dataChannelRef.current = dc;

        // Add sendonly transceiver — actual mic track swapped in on PTT press
        const transceiver = pc.addTransceiver("audio", {
          direction: "sendonly",
        });
        transceiverRef.current = transceiver;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch(`${REALTIME_CALLS_URL}?model=${REALTIME_MODEL}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });

        if (!sdpRes.ok) {
          const errText = await sdpRes.text().catch(() => "");
          throw new Error(`WebRTC SDP exchange failed: ${sdpRes.status}${errText ? ` — ${errText}` : ""}`);
        }

        const answerSdp = await sdpRes.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        updateState("connected");
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        optionsRef.current.onError?.(error);
        updateState("error");
      }
    },
    [updateState]
  );

  const disconnect = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    transceiverRef.current = null;
    updateState("idle");
  }, [updateState]);

  const replaceAudioTrack = useCallback(
    (track: MediaStreamTrack | null) => {
      const sender = transceiverRef.current?.sender;
      if (!sender) return;
      sender.replaceTrack(track);
    },
    []
  );

  // Called after PTT release — tells the model to generate a response
  const triggerResponse = useCallback(() => {
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({ type: "response.create" }));
  }, []);

  return { state, connect, disconnect, replaceAudioTrack, triggerResponse };
}
