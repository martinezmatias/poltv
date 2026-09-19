"use client";

import { useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma, type ManagedRealtimeSession, type WmaRealtimeSession } from "@fal-ai/client/realtime";
import { INITIAL_ASSISTANT_MESSAGE } from "../prompt/assistant";
import { INITIAL_PROMPT } from "../prompt/initial";

type ConnectionState = "Idle" | "Connecting" | "Live" | "Error";
type VideoMode = "mock" | "clips" | "director";
type LogEntry = { timestamp: string; message: string };
type ConversationMessage = { role: "user" | "assistant"; content: string };
type AgentDecision = {
  reply: string;
  update_video: boolean;
  video_instruction: string | null;
};

const TEST_DURATION_MS = 60_000;
const MOCK_VIDEO_URL = "/resources/zIYbTMoXfFY0e3iIUQ0bq_minimax-h3.mp4";
const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://localhost:8000";
const TEXT_TO_VIDEO_ENDPOINT = "minimax/h3-max/text-to-video";

const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });
const textToVideoFal = fal as unknown as {
  subscribe: (
    endpoint: string,
    options: {
      input: Record<string, unknown>;
      logs: boolean;
      onQueueUpdate: (status: { status: string }) => void;
    },
  ) => Promise<{ data: { video: { url: string } } }>;
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<ManagedRealtimeSession<WmaRealtimeSession> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const promptVersionRef = useRef(1);
  const mediaReceivedRef = useRef(false);
  const connectedRef = useRef(false);
  const agentSessionIdRef = useRef("");
  const [state, setState] = useState<ConnectionState>("Idle");
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState<VideoMode>("mock");
  const [direction, setDirection] = useState("");
  const [directionFeedback, setDirectionFeedback] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [conversation, setConversation] = useState<ConversationMessage[]>([
    { role: "assistant", content: INITIAL_ASSISTANT_MESSAGE },
  ]);
  const [messageInput, setMessageInput] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [generatedInstruction, setGeneratedInstruction] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipStatus, setClipStatus] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);

  const logEvent = (message: string) => {
    const elapsed = sessionStartRef.current === null ? 0 : (performance.now() - sessionStartRef.current) / 1000;
    setLogs((currentLogs) => [
      ...currentLogs,
      {
        timestamp: `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toFixed(1).padStart(4, "0")}`,
        message,
      },
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
    } else if (videoMode !== "director" && video) {
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

    if (videoMode !== "director") {
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
              setDirectionFeedback(
                `Direction ${message.prompt_version} acknowledged for upcoming generation.`,
              );
              logEvent(`FAL reply: direction ${message.prompt_version} accepted (prompt_applied)`);
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

  const generateCinematicClip = async (instruction: string) => {
    if (clipLoading) {
      logEvent("Cinematic clip generation already in progress");
      return;
    }

    setClipLoading(true);
    setClipError(null);
    setClipStatus("Generating cinematic clip...");
    logEvent("Cinematic clip generation requested");

    try {
      const result = await textToVideoFal.subscribe(TEXT_TO_VIDEO_ENDPOINT, {
        input: {
          prompt: instruction,
          duration: 5,
          resolution: "480P",
          prompt_expansion_mode: "disabled",
          aspect_ratio: "16:9",
        },
        logs: true,
        onQueueUpdate: (status) => {
          if (status.status === "IN_QUEUE") setClipStatus("Cinematic clip queued...");
          if (status.status === "IN_PROGRESS") setClipStatus("Generating cinematic clip...");
        },
      });
      const videoUrl = result.data.video.url;
      setClipStatus("Cinematic clip ready");
      logEvent("Cinematic clip ready");

      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
        video.src = videoUrl;
        video.loop = false;
        video.load();
        void video.play().catch(() => {
          setClipError("The browser blocked autoplay. Press the video play button.");
        });
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setClipError(message);
      setClipStatus(null);
      logEvent(`Error: cinematic clip generation failed (${message})`);
    } finally {
      setClipLoading(false);
    }
  };

  const sendVideoInstruction = (instruction: string, source: string) => {
    const trimmedInstruction = instruction.trim();
    if (!trimmedInstruction) return;

    setGeneratedInstruction(trimmedInstruction);

    if (videoMode === "mock") {
      logEvent(`${source} produced video instruction (mock only)`);
      return;
    }

    if (videoMode === "clips") {
      void generateCinematicClip(trimmedInstruction);
      return;
    }

    const session = sessionRef.current;
    if (!session || state !== "Live") {
      const message = "Director is not running, so the instruction was not sent.";
      setError(message);
      logEvent(`Error: ${message}`);
      return;
    }

    const nextVersion = promptVersionRef.current + 1;
    promptVersionRef.current = nextVersion;
    session.send({
      type: "prompt",
      prompt: trimmedInstruction,
      script_mode: "replace",
      replan: true,
      prompt_version: nextVersion,
    });
    logEvent(`${source} Director instruction ${nextVersion} submitted`);
    setDirectionFeedback(`Direction ${nextVersion} submitted.`);
  };

  const sendDirection = () => {
    const trimmedDirection = direction.trim();
    if (!trimmedDirection || state !== "Live") return;

    setDirection("");
    sendVideoInstruction(trimmedDirection, "Raw");
  };

  const sendMessage = async () => {
    const trimmedMessage = messageInput.trim();
    if (!trimmedMessage || agentLoading) return;

    if (!agentSessionIdRef.current) {
      agentSessionIdRef.current = crypto.randomUUID();
    }

    setConversation((current) => [...current, { role: "user", content: trimmedMessage }]);
    setMessageInput("");
    setAgentLoading(true);
    setAgentError(null);

    try {
      const response = await fetch(`${AGENT_API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: agentSessionIdRef.current, message: trimmedMessage }),
      });

      const payload = (await response.json()) as AgentDecision & { detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? `Agent request failed (${response.status})`);
      if (typeof payload.reply !== "string" || typeof payload.update_video !== "boolean") {
        throw new Error("Agent returned an invalid structured response.");
      }

      setConversation((current) => [...current, { role: "assistant", content: payload.reply }]);
      if (payload.update_video) {
        if (!payload.video_instruction) {
          throw new Error("Agent requested a video update without a video instruction.");
        }
        sendVideoInstruction(payload.video_instruction, "Agent");
      }
    } catch (nextError) {
      if (nextError instanceof TypeError && nextError.message === "Failed to fetch") {
        setAgentError(`Agent backend unavailable at ${AGENT_API_URL}. Start FastAPI on port 8000.`);
      } else {
        setAgentError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    } finally {
      setAgentLoading(false);
    }
  };

  return (
    <main>
      <p>
        Mode: {videoMode === "mock" ? "MOCK" : videoMode === "clips" ? "CINEMATIC CLIPS" : "LIVE DIRECTOR"}
      </p>
      <p>Status: {state}</p>
      <video ref={videoRef} autoPlay playsInline controls />
      <p>
        <label>
          Video mode:{" "}
          <select
            value={videoMode}
            onChange={(event) => setVideoMode(event.target.value as VideoMode)}
            disabled={state === "Connecting" || state === "Live"}
          >
            <option value="mock">Mock</option>
            <option value="clips">Cinematic Clips</option>
            <option value="director">Director</option>
          </select>
        </label>
      </p>
      <p>
        <button type="button" onClick={startSession} disabled={state === "Connecting" || state === "Live"}>
          Start
        </button>{" "}
        <button type="button" onClick={stopSession} disabled={!sessionActive}>
          Stop Session
        </button>
      </p>

      <section>
        <h2>{INITIAL_ASSISTANT_MESSAGE}</h2>
        <div role="log" aria-live="polite">
          {conversation.map((message, index) => (
            <p key={`${message.role}-${index}`}>
              <strong>{message.role === "assistant" ? "Assistant" : "You"}:</strong> {message.content}
            </p>
          ))}
        </div>
        <textarea
          value={messageInput}
          onChange={(event) => setMessageInput(event.target.value)}
          placeholder="Tell the assistant what you want to watch"
          rows={3}
          disabled={agentLoading}
        />
        <p>
          <button type="button" onClick={sendMessage} disabled={agentLoading || !messageInput.trim()}>
            {agentLoading ? "Thinking..." : "Send"}
          </button>
        </p>
        {clipStatus ? <p role="status">{clipStatus}</p> : null}
        {clipError ? <p role="alert">Clip error: {clipError}</p> : null}
        {agentError ? <p role="alert">Agent error: {agentError}</p> : null}
      </section>

      {generatedInstruction ? (
        <details>
          <summary>Last generated video instruction</summary>
          <pre>{generatedInstruction}</pre>
        </details>
      ) : null}

      <details>
        <summary>Developer: raw Director steering</summary>
        <textarea
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          placeholder="Enter a raw Director direction"
          rows={4}
          disabled={videoMode !== "director" || state !== "Live"}
        />
        <p>
          <button
            type="button"
            onClick={sendDirection}
            disabled={videoMode !== "director" || state !== "Live" || !direction.trim()}
          >
            Send raw direction
          </button>
        </p>
        {directionFeedback ? <p role="status">{directionFeedback}</p> : null}
      </details>

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
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
