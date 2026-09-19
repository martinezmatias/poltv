"use client";

import { useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma, type ManagedRealtimeSession, type WmaRealtimeSession } from "@fal-ai/client/realtime";
import { VIDEO_CONFIG } from "../config/video";
import { INITIAL_ASSISTANT_MESSAGE } from "../prompt/assistant";
import { buildImageToVideoPrompt } from "../prompt/image-to-video";
import { INITIAL_PROMPT } from "../prompt/initial";
import { CinematicShell } from "./components/CinematicShell";
import { MediaStage } from "./components/MediaStage";
import { ProfileSelector } from "./components/ProfileSelector";
import { QuickSuggestions } from "./components/QuickSuggestions";
import type { CatalogCandidate as ComponentCatalogCandidate } from "./components/types";

type ConnectionState = "Idle" | "Connecting" | "Live" | "Error";
type VideoMode = "mock" | "clips" | "director";
type ClipMethod = "text-to-video" | "image-to-video";
type LogEntry = { timestamp: string; message: string };
type ConversationMessage = { role: "user" | "assistant"; content: string };
type AgentDecision = {
  reply: string;
  suggestions?: string[];
  update_video: boolean;
  video_instruction: string | null;
  needs_catalog?: boolean;
  catalog_query?: CatalogQuery | null;
  catalog_retrieved?: boolean;
  catalog_candidates?: CatalogCandidate[];
  catalog_retrieval_candidates?: CatalogCandidate[];
  catalog_error?: string | null;
  conversation_revision?: number;
  video_action_id?: string | null;
  continuation_skipped?: boolean;
};
type CatalogQuery = {
  media_type: "movie" | "tv" | "both";
  title_query: string | null;
  genres: string[];
  year_from: number | null;
  year_to: number | null;
};
type CatalogCandidate = ComponentCatalogCandidate;

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
  const activeClipActionRef = useRef<string | null>(null);
  const continuationClaimedRef = useRef<Set<string>>(new Set());
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
  const [suggestions, setSuggestions] = useState([
    "Make me laugh",
    "Something gripping",
    "Family night",
    "Surprise me",
  ]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [catalogDebug, setCatalogDebug] = useState<{
    called: boolean;
    retrieved: boolean;
    query: CatalogQuery | null;
    candidates: CatalogCandidate[];
    retrievalCandidates: CatalogCandidate[];
    error: string | null;
  } | null>(null);
  const [recommendations, setRecommendations] = useState<CatalogCandidate[]>([]);
  const [selectedRecommendation, setSelectedRecommendation] = useState<CatalogCandidate | null>(null);
  const [generatedInstruction, setGeneratedInstruction] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipStatus, setClipStatus] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [continuationLoading, setContinuationLoading] = useState(false);
  const [continuationError, setContinuationError] = useState<string | null>(null);

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
    if (video) video.onended = null;
    activeClipActionRef.current = null;

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
    if (videoRef.current) videoRef.current.onended = null;
    activeClipActionRef.current = null;
    logEvent("Session start requested");

    if (videoMode !== "director") {
      const video = videoRef.current;
      if (!video) return;

      video.onended = null;
      activeClipActionRef.current = null;
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

  const continueAfterVideo = async (
    actionId: string,
    conversationRevision: number,
    mode: "mock" | "text-to-video" | "image-to-video",
    instruction: string,
  ) => {
    if (continuationClaimedRef.current.has(actionId)) return;
    continuationClaimedRef.current.add(actionId);
    setContinuationLoading(true);
    setContinuationError(null);
    logEvent("Post-video continuation requested");

    try {
      const response = await fetch(`${AGENT_API_URL}/continue-after-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: agentSessionIdRef.current,
          video_action_id: actionId,
          conversation_revision: conversationRevision,
          mode,
          video_instruction: instruction,
        }),
      });
      const payload = (await response.json()) as AgentDecision & { detail?: string };
      if (!response.ok) {
        throw new Error(formatApiError(payload.detail ?? `Continuation failed (${response.status})`));
      }
      if (payload.continuation_skipped) {
        logEvent("Post-video continuation skipped because the clip is stale or already handled");
        return;
      }
      if (payload.update_video) {
        throw new Error("Continuation attempted to request another video; request suppressed.");
      }
      setConversation((current) => [...current, { role: "assistant", content: payload.reply }]);
      setSuggestions(payload.suggestions ?? []);
      if (payload.catalog_retrieved || payload.catalog_error || payload.catalog_query) {
        const catalogCandidates = payload.catalog_candidates ?? [];
        const retrievalCandidates = payload.catalog_retrieval_candidates ?? catalogCandidates;
        const catalogError = payload.catalog_error ?? null;
        setCatalogDebug({
          called: true,
          retrieved: Boolean(payload.catalog_retrieved),
          query: payload.catalog_query ?? null,
          candidates: catalogCandidates,
          retrievalCandidates,
          error: catalogError,
        });
        if (payload.catalog_retrieved) setRecommendations(catalogCandidates);
        logEvent(`TMDB called during continuation with input: ${JSON.stringify(payload.catalog_query ?? null)}`);
        logEvent(
          catalogError
            ? `TMDB output error: ${catalogError}`
            : `TMDB output during continuation: ${retrievalCandidates.length} retrieved, ${catalogCandidates.length} presented candidate(s)`,
        );
      }
      logEvent("Post-video continuation received");
    } catch (nextError) {
      const message = nextError instanceof TypeError && nextError.message === "Failed to fetch"
        ? `Agent backend unavailable at ${AGENT_API_URL}. Start FastAPI on port 8000.`
        : nextError instanceof Error ? nextError.message : String(nextError);
      setContinuationError(message);
      logEvent(`Error: post-video continuation failed (${message})`);
    } finally {
      setContinuationLoading(false);
    }
  };

  const generateCinematicClip = async (
    instruction: string,
    actionId: string,
    conversationRevision: number,
  ) => {
    if (clipLoading) {
      logEvent("Cinematic clip generation already in progress");
      return;
    }

    setClipLoading(true);
    setClipError(null);
    setClipStatus("Generating cinematic clip...");
    logEvent("Cinematic clip generation requested");

    try {
      const generationMethod = clipMethod;
      const clipConfig =
        generationMethod === "image-to-video"
          ? VIDEO_CONFIG.cinematicClips.imageToVideo
          : VIDEO_CONFIG.cinematicClips.textToVideo;

      if (generationMethod === "image-to-video" && !referenceImage) {
        const message = "Image-to-Video requires a reference image before generating a clip.";
        setClipError(message);
        setClipStatus(null);
        logEvent(`Error: ${message}`);
        return;
      }

      const input: Record<string, unknown> = {
        prompt:
          generationMethod === "image-to-video" ? buildImageToVideoPrompt(instruction) : instruction,
        duration: clipConfig.duration,
        resolution: clipConfig.resolution,
        prompt_expansion_mode: clipConfig.promptExpansionMode,
      };
      if (generationMethod === "image-to-video") {
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
        activeClipActionRef.current = actionId;
        video.srcObject = null;
        video.src = videoUrl;
        video.loop = false;
        video.onended = () => {
          if (activeClipActionRef.current !== actionId) return;
          void continueAfterVideo(
            actionId,
            conversationRevision,
            generationMethod,
            instruction,
          );
        };
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

  const sendVideoInstruction = (
    instruction: string,
    source: string,
    videoActionId?: string | null,
    conversationRevision?: number,
  ) => {
    const trimmedInstruction = instruction.trim();
    if (!trimmedInstruction) return;

    setGeneratedInstruction(trimmedInstruction);

    if (videoMode === "mock") {
      logEvent(`${source} produced video instruction (mock only)`);
      if (!sessionActive && state !== "Live") {
        startSession();
      }
      if (videoActionId && conversationRevision !== undefined) {
        void continueAfterVideo(videoActionId, conversationRevision, "mock", trimmedInstruction);
      }
      return;
    }

    if (videoMode === "clips") {
      if (!videoActionId || conversationRevision === undefined) {
        setClipError("The video action is missing its conversation identity.");
        return;
      }
      void generateCinematicClip(trimmedInstruction, videoActionId, conversationRevision);
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

  const sendMessage = async (selectedCandidate?: CatalogCandidate, suggestedMessage?: string) => {
    const trimmedMessage = selectedCandidate
      ? `I'm interested in ${selectedCandidate.title}.`
      : (suggestedMessage ?? messageInput).trim();
    if (!trimmedMessage || agentLoading || continuationLoading) return;

    if (!agentSessionIdRef.current) {
      agentSessionIdRef.current = crypto.randomUUID();
    }

    setConversation((current) => [...current, { role: "user", content: trimmedMessage }]);
    setMessageInput("");
    if (selectedCandidate) setSelectedRecommendation(selectedCandidate);
    setAgentLoading(true);
    setAgentError(null);

    try {
      const response = await fetch(`${AGENT_API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: agentSessionIdRef.current,
          message: trimmedMessage,
          selected_catalog: selectedCandidate
            ? {
                tmdb_id: selectedCandidate.tmdb_id,
                media_type: selectedCandidate.media_type,
                title: selectedCandidate.title,
              }
            : null,
        }),
      });

      const payload = (await response.json()) as AgentDecision & { detail?: string };
      if (!response.ok) {
        throw new Error(formatApiError(payload.detail ?? `Agent request failed (${response.status})`));
      }
      if (typeof payload.reply !== "string" || typeof payload.update_video !== "boolean") {
        throw new Error("Agent returned an invalid structured response.");
      }

      setConversation((current) => [...current, { role: "assistant", content: payload.reply }]);
      setSuggestions(payload.suggestions ?? []);
      if (payload.catalog_retrieved || payload.catalog_error || payload.catalog_query) {
        const catalogQuery = payload.catalog_query ?? null;
        const catalogCandidates = payload.catalog_candidates ?? [];
        const retrievalCandidates = payload.catalog_retrieval_candidates ?? catalogCandidates;
        const catalogError = payload.catalog_error ?? null;
        setCatalogDebug({
          called: true,
          retrieved: Boolean(payload.catalog_retrieved),
          query: catalogQuery,
          candidates: catalogCandidates,
          retrievalCandidates,
          error: catalogError,
        });
        if (payload.catalog_retrieved) setRecommendations(catalogCandidates);
        logEvent(`TMDB called with input: ${JSON.stringify(catalogQuery)}`);
        logEvent(
          catalogError
            ? `TMDB output error: ${catalogError}`
            : `TMDB output: ${retrievalCandidates.length} retrieved, ${catalogCandidates.length} presented candidate(s)`,
        );
      }
      if (payload.update_video) {
        if (!payload.video_instruction) {
          throw new Error("Agent requested a video update without a video instruction.");
        }
        if (!payload.video_action_id || payload.conversation_revision === undefined) {
          throw new Error("Agent video action is missing its conversation identity.");
        }
        sendVideoInstruction(
          payload.video_instruction,
          "Agent",
          payload.video_action_id,
          payload.conversation_revision,
        );
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

  const settingsPanel = (
    <details className="settings-popover">
      <summary aria-label="Open settings">⚙</summary>
      <div className="settings-panel">
        <span className="eyebrow">Demo controls</span>
        <label>Visual mode
          <select value={videoMode} onChange={(event) => setVideoMode(event.target.value as VideoMode)} disabled={state === "Connecting" || state === "Live"}>
            <option value="mock">Mock</option>
            <option value="clips">Cinematic Clips</option>
            <option value="director">Director</option>
          </select>
        </label>
        {videoMode !== "director" ? (
          <>
            <label>Clip method
              <select value={clipMethod} onChange={(event) => setClipMethod(event.target.value as ClipMethod)} disabled={clipLoading}>
                <option value="text-to-video">Text-to-Video</option>
                <option value="image-to-video">Image-to-Video</option>
              </select>
            </label>
            {clipMethod === "image-to-video" ? (
              <div className="reference-control">
                <span>Reference image</span>
                <input ref={referenceInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && !file.type.startsWith("image/")) {
                    replaceReferenceImage(null);
                    setClipError("Please select a PNG, JPEG, or WebP image.");
                    event.currentTarget.value = "";
                    return;
                  }
                  setClipError(null);
                  replaceReferenceImage(file);
                }} />
                {referencePreviewUrl ? <button type="button" className="text-button" onClick={() => {
                  replaceReferenceImage(null);
                  if (referenceInputRef.current) referenceInputRef.current.value = "";
                }} disabled={clipLoading}>Remove reference</button> : <small>No reference selected.</small>}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="settings-actions">
          <button type="button" className="primary-button" onClick={startSession} disabled={state === "Connecting" || state === "Live"}>Start experience</button>
          <button type="button" className="secondary-button" onClick={stopSession} disabled={!sessionActive}>Stop session</button>
        </div>
        <details className="developer-details">
          <summary>Developer tools</summary>
          <p className="muted">Status: {state} · Mode: {videoMode}</p>
          <textarea value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="Raw Director direction" rows={3} disabled={videoMode !== "director" || state !== "Live"} />
          <button type="button" className="secondary-button" onClick={sendDirection} disabled={videoMode !== "director" || state !== "Live" || !direction.trim()}>Send raw direction</button>
          {directionFeedback ? <p role="status" className="muted">{directionFeedback}</p> : null}
          {generatedInstruction ? <details><summary>Last video instruction</summary><pre>{generatedInstruction}</pre></details> : null}
          {catalogDebug ? <details><summary>TMDB retrieval debug</summary><pre>{JSON.stringify({ input: catalogDebug.query, output: { retrieval_candidates: catalogDebug.retrievalCandidates, presented_candidates: catalogDebug.candidates, error: catalogDebug.error } }, null, 2)}</pre></details> : null}
          <details><summary>Experiment log</summary><ul className="experiment-log">{logs.map((entry, index) => <li key={`${entry.timestamp}-${index}`}><code>{entry.timestamp}</code> {entry.message}</li>)}</ul></details>
        </details>
      </div>
    </details>
  );

  return (
    <CinematicShell
      conversation={(
        <>
          <ProfileSelector />
          <div className="conversation-intro">
            <span className="eyebrow">Your night, your story</span>
            <h1>{INITIAL_ASSISTANT_MESSAGE}</h1>
            <p>Tell Pol what you&apos;re in the mood for.</p>
          </div>
          <div className="conversation-history" role="log" aria-live="polite">
            {conversation.map((message, index) => (
              <article className={`message message-${message.role}`} key={`${message.role}-${index}`}>
                <span className="message-label">{message.role === "assistant" ? "Pol" : "You"}</span>
                <p>{message.content}</p>
              </article>
            ))}
            {agentLoading ? <p className="processing-note">Pol is thinking<span className="ellipsis">...</span></p> : null}
            {continuationLoading ? <p className="processing-note">Finding the next scene<span className="ellipsis">...</span></p> : null}
          </div>
          <div className="conversation-compose">
            <QuickSuggestions suggestions={suggestions} onSelect={(suggestion) => void sendMessage(undefined, suggestion)} disabled={agentLoading || continuationLoading} />
            <div className="chat-input-wrap">
              <textarea value={messageInput} onChange={(event) => setMessageInput(event.target.value)} placeholder="Tell Pol what you're looking for…" rows={1} disabled={agentLoading || continuationLoading} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (messageInput.trim()) void sendMessage();
                }
              }} />
              <button type="button" className="send-button" aria-label="Send message" onClick={() => void sendMessage()} disabled={agentLoading || continuationLoading || !messageInput.trim()}>↑</button>
            </div>
            {clipStatus ? <p className="status-note">{clipStatus}</p> : null}
            {continuationError ? <p role="alert" className="error-note">Continuation error: {continuationError}</p> : null}
            {clipError ? <p role="alert" className="error-note">Clip error: {clipError}</p> : null}
            {agentError ? <p role="alert" className="error-note">Agent error: {agentError}</p> : null}
            {error ? <p role="alert" className="error-note">{error}</p> : null}
          </div>
        </>
      )}
      stage={(
        <MediaStage
          videoRef={videoRef}
          recommendations={recommendations}
          selectedRecommendation={selectedRecommendation}
          onSelectRecommendation={(candidate) => void sendMessage(candidate)}
          recommendationDisabled={agentLoading || continuationLoading}
          stageLabel={state === "Live" ? "Live experience" : videoMode === "director" ? "Director ready" : "Pol's theatre"}
          showControls={Boolean(error || clipError)}
          settings={settingsPanel}
        />
      )}
    />
  );
}
