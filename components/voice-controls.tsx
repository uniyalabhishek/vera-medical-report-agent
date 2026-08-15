"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square, Volume2, VolumeX } from "lucide-react";
import type { Intake } from "@/lib/contracts";
import { medicalReportApi } from "@/lib/client/api";
import { getMessages, message } from "@/lib/i18n";

const MAX_RECORDING_SECONDS = 28;
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export function VoiceInputButton({
  caseId,
  disabled,
  enabled,
  language,
  onTranscript,
  variant = "button",
}: {
  caseId?: string;
  disabled: boolean;
  enabled: boolean;
  language: Intake["language"];
  onTranscript: (transcript: string) => void;
  variant?: "button" | "inline" | "composer";
}) {
  const copy = getMessages(language);
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [, setSeconds] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => {
    discardRef.current = true;
    clearTimer();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopTracks();
  }, []);

  if (!enabled) return null;

  const stopRecording = () => {
    clearTimer();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const startRecording = async () => {
    discardRef.current = false;
    setStatus(null);
    const mimeType = RECORDING_MIME_TYPES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate)
    );
    if (!mimeType) {
      setStatus(copy.voiceFailed);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      setSeconds(0);

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        stopTracks();
        if (discardRef.current) {
          chunksRef.current = [];
          return;
        }
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        chunksRef.current = [];
        if (audio.size === 0) {
          setState("idle");
          setStatus(copy.voiceFailed);
          return;
        }
        setState("transcribing");
        setStatus(copy.transcribing);
        try {
          const transcript = caseId
            ? await medicalReportApi.transcribe(caseId, audio)
            : await medicalReportApi.transcribeIntake(language, audio);
          onTranscript(transcript);
          setStatus(copy.transcriptReady);
        } catch {
          setStatus(copy.voiceFailed);
        } finally {
          setState("idle");
        }
      });

      recorder.start(250);
      setState("recording");
      setStatus(message(language, "recording", { seconds: 0 }));
      timerRef.current = setInterval(() => {
        setSeconds((current) => {
          const next = current + 1;
          setStatus(message(language, "recording", { seconds: next }));
          if (next >= MAX_RECORDING_SECONDS) stopRecording();
          return next;
        });
      }, 1_000);
    } catch {
      stopTracks();
      setState("idle");
      setStatus(copy.microphoneDenied);
    }
  };

  return (
    <div className={`voice-control voice-control--${variant}`}>
      <button
        aria-pressed={state === "recording"}
        aria-label={variant === "composer" ? copy.recordQuestion : undefined}
        className={`voice-button voice-button--${variant} ${state === "recording" ? "is-recording" : ""}`}
        disabled={disabled || state === "transcribing"}
        onClick={() => state === "recording" ? stopRecording() : void startRecording()}
        type="button"
      >
        {state === "recording" ? <Square aria-hidden="true" /> : state === "transcribing" ? <LoaderCircle className="spinner spinner--dark" aria-hidden="true" /> : <Mic aria-hidden="true" />}
        {variant !== "composer" ? (
          <span>{state === "recording"
            ? copy.stopRecording
            : state === "transcribing"
              ? copy.transcribing
              : caseId ? copy.recordQuestion : copy.speakSymptoms}</span>
        ) : null}
      </button>
      {status ? <span className="voice-control__status" role="status">{status}</span> : null}
    </div>
  );
}

export function ListenButton({
  caseId,
  enabled,
  language,
  text,
  variant = "default",
}: {
  caseId: string;
  enabled: boolean;
  language: Intake["language"];
  text: string;
  variant?: "default" | "answer" | "round";
}) {
  const copy = getMessages(language);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setState("idle");
  };

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);
  if (!enabled || !text.trim()) return null;

  const play = async () => {
    if (state === "playing") {
      stop();
      return;
    }
    setError(false);
    setState("loading");
    try {
      const blob = await medicalReportApi.speak(caseId, text);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", stop, { once: true });
      await audio.play();
      setState("playing");
    } catch {
      stop();
      setError(true);
    }
  };

  return (
    <span className={`listen-control listen-control--${variant}`}>
      <button
        aria-label={variant === "round" ? copy.listen : undefined}
        className={`listen-button listen-button--${variant}`}
        onClick={() => void play()}
        type="button"
      >
        {state === "loading" ? (
          <LoaderCircle className="spinner spinner--dark" aria-hidden="true" />
        ) : state === "playing" ? (
          <VolumeX aria-hidden="true" />
        ) : (
          <Volume2 aria-hidden="true" />
        )}
        {variant === "answer" ? <span className="listen-wave" aria-hidden="true"><i /><i /><i /><i /></span> : null}
        {variant !== "round"
          ? state === "loading" ? copy.audioLoading : state === "playing" ? copy.stopListening : copy.listen
          : null}
      </button>
      {error ? <span className="listen-control__error" role="alert">{copy.audioFailed}</span> : null}
    </span>
  );
}
