"use client";

import { useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma, type ManagedRealtimeSession, type WmaRealtimeSession } from "@fal-ai/client/realtime";
import { VIDEO_CONFIG } from "../config/video";
import { INITIAL_ASSISTANT_MESSAGE } from "../prompt/assistant";
import { buildImageToVideoPrompt } from "../prompt/image-to-video";
import { INITIAL_PROMPT } from "../prompt/initial";

type ConnectionState = "Idle" | "Connecting" | "Live" | "Error";
type VideoMode = "mock" | "clips" | "director";
type ClipMethod = "text-to-video" | "image-to-video";
type LogEntry = { timestamp: string; message: string };
type ConversationMessage = { role: "user" | "assistant"; content: string };
type AgentDecision = {
  reply: string;
  update_video: boolean;
  video_instruction: string | null;
  needs_catalog?: boolean;
  catalog_query?: CatalogQuery | null;
  catalog_retrieved?: boolean;
  catalog_candidates?: CatalogCandidate[];
  catalog_error?: string | null;
};
type CatalogQuery = {
  media_type: "movie" | "tv" | "both";
  title_query: string | null;
  genres: string[];
  year_from: number | null;
  year_to: number | null;
};
type CatalogCandidate = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  year: number | null;
  genres: string[];
  overview: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  original_language: string;
  poster_path: string | null;
};

const MOCK_VIDEO_URL = "/resources/IhT_nkpXeYG8F9YsGbVH0_minimax-h3.mp4";
const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://localhost:8000";

const formatApiError = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });
const cinematicClipFal = fal as unknown as {
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
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const referencePreviewUrlRef = useRef<string | null>(null);
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
  const [clipMethod, setClipMethod] = useState<ClipMethod>("text-to-video");
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  const [directionFeedback, setDirectionFeedback] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [conversation, setConversation] = useState<ConversationMessage[]>([
    { role: "assistant", content: INITIAL_ASSISTANT_MESSAGE },
  ]);
  const [messageInput, setMessageInput] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [catalogDebug, setCatalogDebug] = useState<{
    called: boolean;
    retrieved: boolean;
    query: CatalogQuery | null;
    candidates: CatalogCandidate[];
    error: string | null;
  } | null>(null);
  const [generatedInstruction, setGeneratedInstruction] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipStatus, setClipStatus] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);

  useEffect(() => () => {
    if (referencePreviewUrlRef.current) URL.revokeObjectURL(referencePreviewUrlRef.current);
  }, []);

  const replaceReferenceImage = (file: File | null) => {
    if (referencePreviewUrlRef.current) URL.revokeObjectURL(referencePreviewUrlRef.current);
    const nextPreviewUrl = file ? URL.createObjectURL(file) : null;
    referencePreviewUrlRef.current = nextPreviewUrl;
    setReferenceImage(file);
    setReferencePreviewUrl(nextPreviewUrl);
  };

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
      }, VIDEO_CONFIG.directorTestDurationMs);
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
      const clipConfig =
        clipMethod === "image-to-video"
          ? VIDEO_CONFIG.cinematicClips.imageToVideo
          : VIDEO_CONFIG.cinematicClips.textToVideo;

      if (clipMethod === "image-to-video" && !referenceImage) {
        const message = "Image-to-Video requires a reference image before generating a clip.";
        setClipError(message);
        setClipStatus(null);
        logEvent(`Error: ${message}`);
        return;
      }

      const input: Record<string, unknown> = {
        prompt:
          clipMethod === "image-to-video" ? buildImageToVideoPrompt(instruction) : instruction,
        duration: clipConfig.duration,
        resolution: clipConfig.resolution,
        prompt_expansion_mode: clipConfig.promptExpansionMode,
      };
      if (clipMethod === "image-to-video") {
        input.image_url = referenceImage;
      } else {
        input.aspect_ratio = VIDEO_CONFIG.cinematicClips.textToVideo.aspectRatio;
      }

      const result = await cinematicClipFal.subscribe(clipConfig.endpoint, {
        input,
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
      if (!sessionActive && state !== "Live") {
        startSession();
      }
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
      if (!response.ok) {
        throw new Error(formatApiError(payload.detail ?? `Agent request failed (${response.status})`));
      }
      if (typeof payload.reply !== "string" || typeof payload.update_video !== "boolean") {
        throw new Error("Agent returned an invalid structured response.");
      }

      setConversation((current) => [...current, { role: "assistant", content: payload.reply }]);
      if (payload.catalog_retrieved || payload.catalog_error || payload.catalog_query) {
        const catalogQuery = payload.catalog_query ?? null;
        const catalogCandidates = payload.catalog_candidates ?? [];
        const catalogError = payload.catalog_error ?? null;
        setCatalogDebug({
          called: true,
          retrieved: Boolean(payload.catalog_retrieved),
          query: catalogQuery,
          candidates: catalogCandidates,
          error: catalogError,
        });
        logEvent(`TMDB called with input: ${JSON.stringify(catalogQuery)}`);
        logEvent(
          catalogError
            ? `TMDB output error: ${catalogError}`
            : `TMDB output: ${catalogCandidates.length} normalized candidate(s)`,
        );
      }
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
      {videoMode !== "director" ? (
        <section>
          <h2>Cinematic Clip settings</h2>
          {videoMode === "mock" ? <p>Mock mode: no fal generation will be requested.</p> : null}
          <p>
            <label>
              Clip method:{" "}
              <select
                value={clipMethod}
                onChange={(event) => setClipMethod(event.target.value as ClipMethod)}
                disabled={clipLoading}
              >
                <option value="text-to-video">Text-to-Video</option>
                <option value="image-to-video">Image-to-Video</option>
              </select>
            </label>
          </p>
          {clipMethod === "image-to-video" ? (
            <>
              <p>Image-to-Video requires a reference image.</p>
              <input
                ref={referenceInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && !file.type.startsWith("image/")) {
                    replaceReferenceImage(null);
                    setClipError("Please select a PNG, JPEG, or WebP image.");
                    event.currentTarget.value = "";
                    return;
                  }
                  setClipError(null);
                  replaceReferenceImage(file);
                }}
              />
              {referencePreviewUrl ? (
                <p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referencePreviewUrl} alt="Selected reference" width={160} />{" "}
                  <button
                    type="button"
                    onClick={() => {
                      replaceReferenceImage(null);
                      if (referenceInputRef.current) referenceInputRef.current.value = "";
                    }}
                    disabled={clipLoading}
                  >
                    Remove image
                  </button>
                </p>
              ) : (
                <p>No reference image selected.</p>
              )}
            </>
          ) : null}
        </section>
      ) : null}
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

      {catalogDebug ? (
        <details>
          <summary>Developer: TMDB retrieval</summary>
          <p>Called: {catalogDebug.called ? "yes" : "no"}</p>
          <p>Retrieved: {catalogDebug.retrieved ? "yes" : "no"}</p>
          {catalogDebug.error ? <p role="alert">TMDB: {catalogDebug.error}</p> : null}
          <pre>
            {JSON.stringify(
              {
                input: catalogDebug.query,
                output: {
                  candidates: catalogDebug.candidates,
                  error: catalogDebug.error,
                },
              },
              null,
              2,
            )}
          </pre>
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
