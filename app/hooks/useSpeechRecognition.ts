"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type RecognitionResult = {
  [index: number]: { transcript: string };
};

type RecognitionEvent = {
  results: {
    [index: number]: RecognitionResult;
  };
};

type RecognitionErrorEvent = { error?: string };

type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionConstructor = new () => RecognitionInstance;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

export type SpeechRecognitionStatus = "idle" | "listening" | "completed" | "error";

type UseSpeechRecognitionOptions = {
  language?: string;
  onTranscript: (transcript: string) => void;
};

export function useSpeechRecognition({ language = "en-US", onTranscript }: UseSpeechRecognitionOptions) {
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const cancelRequestedRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const isSupported = useSyncExternalStore(
    () => () => undefined,
    () => {
    const speechWindow = window as SpeechRecognitionWindow;
    return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition);
    },
    () => false,
  );
  const [status, setStatus] = useState<SpeechRecognitionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stop = () => {
    cancelRequestedRef.current = true;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setStatus("idle");
  };

  const start = () => {
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition || recognitionRef.current) return;

    setError(null);
    cancelRequestedRef.current = false;
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = language;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setStatus("listening");
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        onTranscriptRef.current(transcript);
        setStatus("completed");
      }
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      if (cancelRequestedRef.current && event.error === "aborted") return;
      setStatus("error");
      setError(event.error === "not-allowed" ? "Microphone permission was denied." : "Voice input could not be recognized.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (cancelRequestedRef.current) {
        setStatus("idle");
      } else {
        setStatus((current) => current === "listening" ? "idle" : current);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setStatus("error");
      setError("Voice input could not be started.");
    }
  };

  useEffect(() => () => {
    cancelRequestedRef.current = true;
    recognitionRef.current?.abort();
  }, []);

  return { isSupported, isListening: status === "listening", status, error, start, stop };
}
