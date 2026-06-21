"use client";

import { useCallback, useRef, useState } from "react";

// Live voice intake via Deepgram. Flow:
//   1. fetch a short-lived JWT from /api/deepgram/token
//   2. open Deepgram's live WS directly with a ['token', jwt] subprotocol
//   3. stream mic audio (MediaRecorder, webm/opus) and surface transcripts
// Final segments are appended via onFinal; interim text streams via onInterim.

interface DeepgramAlt {
  transcript: string;
}
interface DeepgramMessage {
  channel?: { alternatives?: DeepgramAlt[] };
  is_final?: boolean;
}

export default function VoiceButton({
  onFinal,
  onInterim,
}: {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
      wsRef.current.close();
    }
    wsRef.current = null;
    recorderRef.current = null;
    streamRef.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const tokRes = await fetch("/api/deepgram/token");
      if (!tokRes.ok) {
        const j = await tokRes.json().catch(() => ({}));
        throw new Error(j.error ?? "Deepgram not configured");
      }
      const { accessToken } = (await tokRes.json()) as { accessToken: string };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const params = new URLSearchParams({
        model: "nova-3",
        interim_results: "true",
        smart_format: "true",
        punctuate: "true",
      });
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params.toString()}`,
        ["token", accessToken]
      );
      wsRef.current = ws;

      ws.onopen = () => {
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        recorder.start(250); // emit a chunk every 250ms
        setRecording(true);
      };

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data as string) as DeepgramMessage;
        const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (!text) return;
        if (msg.is_final) onFinal(text);
        else onInterim(text);
      };

      ws.onerror = () => setError("Voice connection error");
      ws.onclose = () => setRecording(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "mic error");
      stop();
    }
  }, [onFinal, onInterim, stop]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          recording
            ? "bg-deny text-white"
            : "border border-border bg-surface text-muted hover:border-accent hover:text-fg"
        }`}
      >
        <span className={recording ? "animate-pulse" : ""}>●</span>
        {recording ? "Stop & use transcript" : "Speak the ask"}
      </button>
      {error && <span className="text-[11px] text-deny">{error}</span>}
    </div>
  );
}
