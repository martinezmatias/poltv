"use client";

import { useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma, type ManagedRealtimeSession, type WmaRealtimeSession } from "@fal-ai/client/realtime";
import { INITIAL_PROMPT } from "../prompt/initial";

type ConnectionState = "Idle" | "Connecting" | "Live" | "Error";
type LogEntry = { timestamp: string; message: string };
const TEST_DURATION_MS = 30_000;
const MOCK_VIDEO_URL = "/resources/zIYbTMoXfFY0e3iIUQ0bq_minimax-h3.mp4";

const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<ManagedRealtimeSession<WmaRealtimeSession> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const promptVersionRef = useRef(1);
  const mediaReceivedRef = useRef(false);
  const connectedRef = useRef(false);
  const [state, setState] = useState<ConnectionState>("Idle");
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(true);
  const [direction, setDirection] = useState("");
  const [directionFeedback, setDirectionFeedback] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const logEvent = (message: string) => {
    const elapsed = sessionStartRef.current === null ? 0 : (performance.now() - sessionStartRef.current) / 1000;
    setLogs((currentLogs) => [
      ...currentLogs,
      { timestamp: `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toFixed(1).padStart(4, "0")}`, message },
    ]);
  };

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        session.send({ type: "stop" });
        void session.close();
      }
    };
  }, []);

  const stopSession = () => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    const session = sessionRef.current;
    sessionRef.current = null;
    const video = videoRef.current;

    if (!session && !sessionActive) return;
    setSessionActive(false);

    if (session) {
      session.send({ type: "stop" });
      void session.close();
    } else if (mockMode && video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }

    if (state !== "Idle") {
      logEvent("Session stopped");
      setState("Idle");
    }
  };

  const startSession = () => {
    if (sessionRef.current) return;

    sessionStartRef.current = performance.now();
    promptVersionRef.current = 1;
    mediaReceivedRef.current = false;
    connectedRef.current = false;
    setLogs([]);
    setState("Connecting");
    setSessionActive(true);
    setError(null);
    setDirectionFeedback(null);
    logEvent("Session start requested");

    if (mockMode) {
      const video = videoRef.current;
      if (!video) return;

      video.srcObject = null;
      video.src = MOCK_VIDEO_URL;
      video.loop = true;
      video.load();
      void video.play().then(
        () => {
          setState("Live");
          logEvent("Mock media playing");
        },
        (nextError) => {
          setState("Error");
          setError(nextError instanceof Error ? nextError.message : String(nextError));
          logEvent("Error: mock media could not play");
        },
      );
      return;
    }

    try {
      const session = fal.realtime.open(wma("minimax/h3-max/director"), {
        receive: ["video", "audio"],
        onMedia: (stream) => {
          const video = videoRef.current;
          if (!video) return;

          video.srcObject = stream;
          if (!mediaReceivedRef.current) {
            mediaReceivedRef.current = true;
            logEvent("First video/media received");
          }
          void video.play().catch(() => {
            setError("The browser blocked autoplay. Press the video play button.");
            logEvent("Error: browser blocked video autoplay");
          });
        },
        onData: (raw) => {
          try {
            const message = JSON.parse(raw);
            if (message?.type === "configured") {
              setState("Live");
              logEvent("Director configured");
            }
            if (message?.type === "prompt_pending") {
              setDirectionFeedback(`Direction ${message.prompt_version} is being prepared.`);
            }
            if (message?.type === "prompt_applied") {
              setDirectionFeedback(`Direction ${message.prompt_version} acknowledged.`);
              logEvent(`Direction ${message.prompt_version} acknowledged`);
            }
            if (message?.type === "prompt_rejected") {
              setDirectionFeedback(`Direction ${message.prompt_version} rejected: ${message.reason}.`);
              logEvent(`Error: direction ${message.prompt_version} rejected (${message.reason})`);
            }
            if (message?.type === "error") {
              setState("Error");
              setError(message.error ?? message.code ?? "Director session error");
              logEvent(`Error: ${message.error ?? message.code ?? "Director session error"}`);
            }
            if (message?.type === "stream_exhausted") {
              sessionRef.current = null;
              setSessionActive(false);
              setState("Idle");
              logEvent("Session stopped");
            }
          } catch {
            setState("Error");
            setError("Received an invalid message from the Director session.");
            logEvent("Error: invalid Director message");
          }
        },
        onState: (nextState) => {
          if (nextState === "live" && !connectedRef.current) {
            connectedRef.current = true;
            logEvent("Director connected");
          }
          if (nextState === "failed") {
            setState("Error");
            logEvent("Error: Director connection failed");
          }
          if (nextState === "closed") {
            if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
            sessionRef.current = null;
            setSessionActive(false);
            setState("Idle");
          }
        },
        onError: (nextError) => {
          sessionRef.current = null;
          setSessionActive(false);
          setState("Error");
          setError(nextError instanceof Error ? nextError.message : String(nextError));
          logEvent(`Error: ${nextError instanceof Error ? nextError.message : String(nextError)}`);
        },
      });

      sessionRef.current = session;
      session.send({
        type: "configure",
        protocol_version: 1,
        prompt_version: 1,
        prompt: INITIAL_PROMPT,
      });

      stopTimerRef.current = setTimeout(() => {
        if (sessionRef.current !== session) return;

        stopSession();
      }, TEST_DURATION_MS);
    } catch (nextError) {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      setSessionActive(false);
      setState("Error");
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      logEvent(`Error: ${nextError instanceof Error ? nextError.message : String(nextError)}`);
    }
  };

  const sendDirection = () => {
    const trimmedDirection = direction.trim();
    if (!trimmedDirection || state !== "Live") return;

    const nextVersion = promptVersionRef.current + 1;
    promptVersionRef.current = nextVersion;
    logEvent(`Direction ${nextVersion} submitted`);
    setDirectionFeedback(`Direction ${nextVersion} submitted.`);
    setDirection("");

    if (mockMode) {
      setDirectionFeedback(`Direction ${nextVersion} acknowledged (mock).`);
      logEvent(`Direction ${nextVersion} acknowledged (mock)`);
      return;
    }

    sessionRef.current?.send({
      type: "prompt",
      prompt: trimmedDirection,
      replan: true,
      prompt_version: nextVersion,
    });
  };

  return (
    <main>
      <p>Mode: {mockMode ? "MOCK" : "LIVE DIRECTOR"}</p>
      <p>Status: {state}</p>
      <video ref={videoRef} autoPlay playsInline controls />
      <p>
        <label>
          <input
            type="checkbox"
            checked={mockMode}
            onChange={(event) => setMockMode(event.target.checked)}
            disabled={state === "Connecting" || state === "Live"}
          />{" "}
          Use local mock video
        </label>
      </p>
      <p>
        <button type="button" onClick={startSession} disabled={state === "Connecting" || state === "Live"}>
          Start
        </button>
        <button type="button" onClick={stopSession} disabled={!sessionActive}>
          Stop Session
        </button>
      </p>
      <section>
        <h2>Director steering</h2>
        <textarea
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          placeholder="Enter a raw Director direction"
          rows={4}
          disabled={state !== "Live"}
        />
        <p>
          <button type="button" onClick={sendDirection} disabled={state !== "Live" || !direction.trim()}>
            Send direction
          </button>
        </p>
        {directionFeedback ? <p role="status">{directionFeedback}</p> : null}
      </section>
      <section>
        <h2>Experiment log</h2>
        <ul>
          {logs.map((entry, index) => (
            <li key={`${entry.timestamp}-${index}`}>
              <code>{entry.timestamp}</code> {entry.message}
            </li>
          ))}
        </ul>
      </section>
      {error ? <p role="alert">Error: {error}</p> : null}
    </main>
  );
}
