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
import { RecommendationRail } from "./components/RecommendationRail";
import type { CatalogCandidate as ComponentCatalogCandidate } from "./components/types";

type ConnectionState = "Idle" | "Connecting" | "Live" | "Error";
type VideoMode = "mock" | "clips" | "director";
type ClipMethod = "text-to-video" | "image-to-video";
type LogEntry = { timestamp: string; message: string };
type ConversationMessage = { role: "user" | "assistant"; content: string };
type AgentDecision = {
  reply: string;
  suggestions?: string[];
  needs_catalog?: boolean;
  catalog_query?: CatalogQuery | null;
  catalog_retrieved?: boolean;
  catalog_candidates?: CatalogCandidate[];
  catalog_retrieval_candidates?: CatalogCandidate[];
  catalog_error?: string | null;
  conversation_revision?: number;
};
type MediaDecision = {
  action: "none" | "update";
  visual_instruction: string | null;
  reason: string;
  conversation_revision: number;
  media_action_id: string | null;
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
  const currentConversationRevisionRef = useRef(0);
  const activeMediaActionRef = useRef<string | null>(null);
  const lastMediaRevisionRef = useRef<number | null>(null);
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
  const [mediaDecisionStatus, setMediaDecisionStatus] = useState<string | null>(null);
  const [mediaDecisionReason, setMediaDecisionReason] = useState<string | null>(null);

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
    const video = videoRef.current;
    if (!video) return;

    sessionStartRef.current = performance.now();
    video.srcObject = null;
    video.src = MOCK_VIDEO_URL;
    video.loop = true;
    // The opening intro should autoplay without requiring a paid Director session.
    // Muting is required by most browsers for autoplay with an audio track.
    video.muted = true;
    video.load();
    void video.play().then(
      () => {
        setSessionActive(true);
        setState("Live");
        logEvent("Intro media playing");
      },
      () => {
        setError("Click Start experience to play the intro.");
        logEvent("Intro autoplay was blocked; waiting for user interaction");
      },
    );
  }, []);

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
    activeMediaActionRef.current = null;

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
      video.muted = true;
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
      const video = videoRef.current;
      if (video) video.muted = false;
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
      if (
        currentConversationRevisionRef.current !== conversationRevision ||
        activeMediaActionRef.current !== actionId
      ) {
        logEvent(`Stale media action ${actionId} suppressed before playback`);
        setClipStatus(null);
        return;
      }
      setClipStatus("Cinematic clip ready");
      logEvent("Cinematic clip ready");

      const video = videoRef.current;
      if (video) {
        activeClipActionRef.current = actionId;
        video.srcObject = null;
        video.src = videoUrl;
        video.loop = false;
        video.onended = null;
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
      setMediaDecisionStatus("Mock visual action applied");
      if (!sessionActive && state !== "Live") {
        startSession();
      }
      return;
    }

    if (videoMode === "clips") {
      if (!videoActionId || conversationRevision === undefined) {
        setClipError("The video action is missing its conversation identity.");
        return;
      }
      setMediaDecisionStatus("Creating cinematic clip...");
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
    setMediaDecisionStatus("Director update submitted");
    setDirectionFeedback(`Direction ${nextVersion} submitted.`);
  };

  const sendDirection = () => {
    const trimmedDirection = direction.trim();
    if (!trimmedDirection || state !== "Live") return;

    setDirection("");
    sendVideoInstruction(trimmedDirection, "Raw");
  };

  const requestMediaOrchestration = async (
    conversationRevision: number,
    userMessage: string,
    assistantReply: string,
    recentMessages: ConversationMessage[],
    latestCandidates: CatalogCandidate[],
    latestSelected: CatalogCandidate | null,
  ) => {
    setMediaDecisionStatus("Pol is considering the visual mood...");
    try {
      const response = await fetch(`${AGENT_API_URL}/media-orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: agentSessionIdRef.current,
          state: {
            recent_messages: [
              ...recentMessages,
              { role: "user", content: userMessage },
              { role: "assistant", content: assistantReply },
            ].slice(-8),
            recent_candidates: latestCandidates,
            selected_catalog: latestSelected
              ? {
                  tmdb_id: latestSelected.tmdb_id,
                  media_type: latestSelected.media_type,
                  title: latestSelected.title,
                }
              : null,
            current_media_state: videoMode === "clips" && generatedInstruction
              ? "generated_clip"
              : latestSelected
                ? "selected_title"
                : recommendations.length > 0
                  ? "recommendations"
                  : videoMode === "director"
                    ? "director"
                    : "intro",
            previous_visual_instruction: generatedInstruction,
            generation_status: clipLoading ? "generating" : state === "Live" && videoMode === "director" ? "streaming" : "idle",
            director_active: videoMode === "director" && state === "Live",
            reference_image_available: Boolean(referenceImage),
            selected_backend: videoMode,
            conversation_revision: conversationRevision,
            last_media_revision: lastMediaRevisionRef.current,
          },
        }),
      });
      const payload = (await response.json()) as MediaDecision & { detail?: string };
      if (!response.ok) throw new Error(formatApiError(payload.detail ?? `Media Orchestrator failed (${response.status})`));
      setMediaDecisionReason(payload.reason || null);
      if (payload.action === "none") {
        setMediaDecisionStatus("No visual update needed");
        logEvent(`Media Orchestrator: none${payload.reason ? ` (${payload.reason})` : ""}`);
        return;
      }
      if (!payload.visual_instruction || !payload.media_action_id) {
        throw new Error("Media Orchestrator returned an incomplete update action.");
      }
      if (currentConversationRevisionRef.current !== payload.conversation_revision) {
        logEvent(`Stale Media Orchestrator action ${payload.media_action_id} suppressed`);
        return;
      }
      activeMediaActionRef.current = payload.media_action_id;
      lastMediaRevisionRef.current = payload.conversation_revision;
      setMediaDecisionStatus("Visual update selected");
      setGeneratedInstruction(payload.visual_instruction);
      logEvent(`Media Orchestrator: update (${payload.media_action_id})`);
      sendVideoInstruction(
        payload.visual_instruction,
        "Media Orchestrator",
        payload.media_action_id,
        payload.conversation_revision,
      );
    } catch (nextError) {
      const message = nextError instanceof TypeError && nextError.message === "Failed to fetch"
        ? `Media Orchestrator unavailable at ${AGENT_API_URL}.`
        : nextError instanceof Error ? nextError.message : String(nextError);
      setMediaDecisionStatus("Media update unavailable");
      setMediaDecisionReason(message);
      logEvent(`Media Orchestrator error: ${message}`);
    }
  };

  const sendMessage = async (selectedCandidate?: CatalogCandidate, suggestedMessage?: string) => {
    const trimmedMessage = selectedCandidate
      ? `I'm interested in ${selectedCandidate.title}.`
      : (suggestedMessage ?? messageInput).trim();
    if (!trimmedMessage || agentLoading) return;

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
      if (typeof payload.reply !== "string") {
        throw new Error("Agent returned an invalid structured response.");
      }
      const conversationRevision = payload.conversation_revision ?? currentConversationRevisionRef.current + 1;
      currentConversationRevisionRef.current = conversationRevision;

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
      void requestMediaOrchestration(
        conversationRevision,
        trimmedMessage,
        payload.reply,
        conversation.slice(-6),
        payload.catalog_candidates ?? recommendations,
        selectedCandidate ?? selectedRecommendation,
      );
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
          </div>
          <div className="conversation-compose">
            <QuickSuggestions suggestions={suggestions} onSelect={(suggestion) => void sendMessage(undefined, suggestion)} disabled={agentLoading} />
            <div className="chat-input-wrap">
              <textarea value={messageInput} onChange={(event) => setMessageInput(event.target.value)} placeholder="Tell Pol what you're looking for…" rows={1} disabled={agentLoading} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (messageInput.trim()) void sendMessage();
                }
              }} />
              <button type="button" className="send-button" aria-label="Send message" onClick={() => void sendMessage()} disabled={agentLoading || !messageInput.trim()}>↑</button>
            </div>
            {mediaDecisionStatus ? <p className="status-note">{mediaDecisionStatus}</p> : null}
            {mediaDecisionReason ? <details className="media-debug"><summary>Media decision</summary><p className="muted">{mediaDecisionReason}</p></details> : null}
            {clipStatus ? <p className="status-note">{clipStatus}</p> : null}
            {clipError ? <p role="alert" className="error-note">Clip error: {clipError}</p> : null}
            {agentError ? <p role="alert" className="error-note">Agent error: {agentError}</p> : null}
            {error ? <p role="alert" className="error-note">{error}</p> : null}
          </div>
        </>
      )}
      stage={(
        <div className={recommendations.length > 0 ? "right-experience discovery-mode" : "right-experience cinematic-mode"}>
          <div className="media-stage-region">
            <MediaStage
              videoRef={videoRef}
              recommendations={recommendations}
              selectedRecommendation={selectedRecommendation}
              stageLabel={state === "Live" ? "Live experience" : videoMode === "director" ? "Director ready" : "Pol's theatre"}
              showControls={Boolean(error || clipError)}
              settings={settingsPanel}
            />
          </div>
          {recommendations.length > 0 ? (
            <div className="discovery-recommendations">
              <RecommendationRail
                recommendations={recommendations}
                onSelect={(candidate) => void sendMessage(candidate)}
                disabled={agentLoading}
              />
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
