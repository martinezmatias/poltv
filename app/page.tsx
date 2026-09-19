"use client";

import { useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma, type ManagedRealtimeSession, type WmaRealtimeSession } from "@fal-ai/client/realtime";
import { DEFAULT_VIEWER_PROFILE_ID, VIEWER_PROFILES } from "../config/profiles";
import { VIDEO_CONFIG } from "../config/video";
import { INITIAL_ASSISTANT_MESSAGE } from "../prompt/assistant";
import { INITIAL_PROMPT } from "../prompt/initial";
import { buildMediaPrompt, normalizePolIntent, type PolRole } from "../prompt/media";
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
  recommendation_revision?: number;
  recommendation_set_updated?: boolean;
  first_substantive_recommendation_moment?: boolean;
};
type MediaDecision = {
  action: "none" | "update";
  visual_instruction: string | null;
  include_pol: boolean;
  pol_role: PolRole;
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

const INTRO_VIDEO_URL = "/resources/Polintro.mp4";
const MOCK_VIDEO_URL = "/resources/polconcassette5s.mp4";
const WAITING_VIDEO_URL = "/resources/polchoosing5s.mp4";
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
  const conversationHistoryRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ManagedRealtimeSession<WmaRealtimeSession> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const promptVersionRef = useRef(1);
  const mediaReceivedRef = useRef(false);
  const connectedRef = useRef(false);
  const agentSessionIdRef = useRef("");
  const selectedProfileIdRef = useRef(DEFAULT_VIEWER_PROFILE_ID);
  const activeClipActionRef = useRef<string | null>(null);
  const currentConversationRevisionRef = useRef(0);
  const activeMediaActionRef = useRef<string | null>(null);
  const lastMediaRevisionRef = useRef<number | null>(null);
  const [state, setState] = useState<ConnectionState>("Idle");
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState<VideoMode>("mock");
  const [activeVideoMode, setActiveVideoMode] = useState<VideoMode>("mock");
  const [clipMethod, setClipMethod] = useState<ClipMethod>("text-to-video");
  const [selectedProfileId, setSelectedProfileId] = useState(DEFAULT_VIEWER_PROFILE_ID);
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

  useEffect(() => {
    const history = conversationHistoryRef.current;
    if (!history) return;
    history.scrollTo({ top: history.scrollHeight, behavior: "smooth" });
  }, [conversation, agentLoading]);

  const selectedProfile = VIEWER_PROFILES.find((profile) => profile.id === selectedProfileId) ?? VIEWER_PROFILES[0];
  const selectProfile = (profileId: string) => {
    selectedProfileIdRef.current = profileId;
    setSelectedProfileId(profileId);
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
    video.src = INTRO_VIDEO_URL;
    video.loop = true;
    // The opening intro should autoplay without requiring a paid Director session.
    // Muting is required by most browsers for autoplay with an audio track.
    video.muted = true;
    video.load();
    void video.play().then(
      () => {
        setSessionActive(true);
        setActiveVideoMode("mock");
        setState("Live");
        logEvent("Intro media playing");
      },
      () => {
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
    if (video) {
      video.onended = null;
      video.onloadeddata = null;
    }
    activeClipActionRef.current = null;
    activeMediaActionRef.current = null;
    setGeneratedInstruction(null);
    setClipStatus(null);

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

  const changeVideoMode = (nextMode: VideoMode) => {
    if (nextMode === videoMode) return;
    setError(null);
    setClipError(null);
    setVideoMode(nextMode);
  };

  const startSession = () => {
    if (sessionRef.current && activeVideoMode === videoMode) return;
    if (sessionRef.current || (sessionActive && activeVideoMode !== videoMode)) stopSession();

    sessionStartRef.current = performance.now();
    promptVersionRef.current = 1;
    mediaReceivedRef.current = false;
    connectedRef.current = false;
    setLogs([]);
    setState("Connecting");
    setSessionActive(true);
    setActiveVideoMode(videoMode);
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
      video.src = videoMode === "mock" ? MOCK_VIDEO_URL : INTRO_VIDEO_URL;
      video.loop = videoMode !== "mock";
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
    const profileIdAtStart = selectedProfileId;
    setClipError(null);
    setClipStatus("Generating cinematic clip...");
    logEvent("Cinematic clip generation requested");

    const video = videoRef.current;
    const previousSource = video?.src ?? "";
    const previousLoop = video?.loop ?? false;
    const previousStream = video?.srcObject ?? null;
    const restorePreviousVideo = () => {
      if (!video) return;
      video.pause();
      video.onloadeddata = null;
      video.srcObject = previousStream;
      if (previousStream) {
        void video.play().catch(() => undefined);
        return;
      }
      if (!previousSource) return;
      video.src = previousSource;
      video.loop = previousLoop;
      video.load();
      void video.play().catch(() => undefined);
    };

    if (video) {
      video.pause();
      video.onloadeddata = null;
      video.srcObject = null;
      video.muted = true;
      video.src = WAITING_VIDEO_URL;
      video.loop = true;
      video.currentTime = 0;
      video.load();
      void video.play().catch(() => {
        logEvent("Waiting video autoplay was blocked");
      });
    }

    try {
      const generationMethod = clipMethod;
      const clipConfig =
        generationMethod === "image-to-video"
          ? VIDEO_CONFIG.cinematicClips.imageToVideo
          : VIDEO_CONFIG.cinematicClips.textToVideo;

      if (generationMethod === "image-to-video" && !selectedProfile.image) {
        const message = "The selected profile has no reference image for Image-to-Video.";
        setClipError(message);
        setClipStatus(null);
        restorePreviousVideo();
        logEvent(`Error: ${message}`);
        return;
      }

      const input: Record<string, unknown> = {
        prompt: instruction,
        duration: clipConfig.duration,
        resolution: clipConfig.resolution,
        prompt_expansion_mode: clipConfig.promptExpansionMode,
      };
      if (generationMethod === "image-to-video") {
        const profileImageUrl = new URL(selectedProfile.image, window.location.origin).toString();
        const profileImageResponse = await fetch(profileImageUrl);
        if (!profileImageResponse.ok) {
          throw new Error(`Unable to load the selected profile image (${profileImageResponse.status}).`);
        }
        const profileImageBlob = await profileImageResponse.blob();
        input.image_url = new File(
          [profileImageBlob],
          `${selectedProfile.id}-reference.${profileImageBlob.type.split("/")[1] ?? "png"}`,
          { type: profileImageBlob.type || "image/png" },
        );
        logEvent(`I2V profile reference resolved: ${selectedProfile.id}`);
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
        activeMediaActionRef.current !== actionId ||
        selectedProfileIdRef.current !== profileIdAtStart
      ) {
        logEvent(`Stale media action ${actionId} suppressed before playback`);
        if (activeMediaActionRef.current === actionId) restorePreviousVideo();
        setClipStatus(null);
        return;
      }
      setClipStatus("Cinematic clip ready");
      logEvent("Cinematic clip ready");

      const video = videoRef.current;
      if (video) {
        activeClipActionRef.current = actionId;
        video.pause();
        video.onloadeddata = null;
        video.srcObject = null;
        video.src = videoUrl;
        video.loop = false;
        video.currentTime = 0;
        video.onended = null;
        video.onloadeddata = () => {
          void video.play().catch(() => {
            setClipError("The browser blocked autoplay. Press the video play button.");
          });
        };
        video.load();
        void video.play().catch(() => undefined);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setClipError(message);
      setClipStatus(null);
      if (activeMediaActionRef.current === actionId) restorePreviousVideo();
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
      setGeneratedInstruction(trimmedInstruction);
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.onloadeddata = null;
        video.srcObject = null;
        video.muted = true;
        video.src = MOCK_VIDEO_URL;
        video.loop = false;
        video.currentTime = 0;
        video.load();
        const playMock = () => video.play();
        video.onloadeddata = playMock;
        void playMock().then(
          () => {
            setSessionActive(true);
            setState("Live");
            logEvent("Mock video playing");
          },
          (nextError) => {
            setError(nextError instanceof Error ? nextError.message : String(nextError));
            logEvent("Error: mock video could not play");
          },
        );
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

  const requestMediaOrchestration = async (
    conversationRevision: number,
    userMessage: string,
    assistantReply: string,
    recentMessages: ConversationMessage[],
    latestCandidates: CatalogCandidate[],
    latestSelected: CatalogCandidate | null,
    recommendationRevision: number,
    recommendationSetUpdated: boolean,
    firstSubstantiveRecommendationMoment: boolean,
  ) => {
    logEvent("Media Orchestrator requested");
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
                : latestCandidates.length > 0
                  ? "recommendations"
                  : videoMode === "director"
                    ? "director"
                    : "intro",
            previous_visual_instruction: generatedInstruction,
            generation_status: clipLoading ? "generating" : state === "Live" && videoMode === "director" ? "streaming" : "idle",
            director_active: videoMode === "director" && state === "Live",
            reference_image_available: Boolean(selectedProfile.image),
            selected_profile_id: selectedProfile.id,
            recommendation_revision: recommendationRevision,
            recommendation_set_updated: recommendationSetUpdated,
            first_substantive_recommendation_moment: firstSubstantiveRecommendationMoment,
            selected_backend: videoMode,
            conversation_revision: conversationRevision,
            last_media_revision: lastMediaRevisionRef.current,
          },
        }),
      });
      const payload = (await response.json()) as MediaDecision & { detail?: string };
      if (!response.ok) throw new Error(formatApiError(payload.detail ?? `Media Orchestrator failed (${response.status})`));
      if (payload.action === "none") {
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
      const backend = videoMode === "clips" ? clipMethod : videoMode === "director" ? "director" : "mock";
      const polIntent = normalizePolIntent(backend, payload.include_pol, payload.pol_role);
      const finalPrompt = buildMediaPrompt(payload.visual_instruction, polIntent.includePol, polIntent.polRole, backend);
      setGeneratedInstruction(finalPrompt);
      logEvent(`Media Orchestrator: update (${payload.media_action_id})`);
      logEvent(`Media intent: include_pol=${polIntent.includePol}, pol_role=${polIntent.polRole}, profile=${selectedProfile.id}, image_available=${Boolean(selectedProfile.image)}`);
      sendVideoInstruction(
        finalPrompt,
        "Media Orchestrator",
        payload.media_action_id,
        payload.conversation_revision,
      );
    } catch (nextError) {
      const message = nextError instanceof TypeError && nextError.message === "Failed to fetch"
        ? `Media Orchestrator unavailable at ${AGENT_API_URL}.`
        : nextError instanceof Error ? nextError.message : String(nextError);
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
      if (payload.recommendation_set_updated) {
        logEvent(`Recommendation set revision ${payload.recommendation_revision ?? "?"} produced${payload.first_substantive_recommendation_moment ? " (first substantive moment)" : ""}`);
      }
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
        payload.recommendation_revision ?? 0,
        Boolean(payload.recommendation_set_updated),
        Boolean(payload.first_substantive_recommendation_moment),
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
          <select value={videoMode} onChange={(event) => changeVideoMode(event.target.value as VideoMode)} disabled={state === "Connecting"}>
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
                <span>Reference: {selectedProfile.name}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="profile-reference-preview" src={selectedProfile.image} alt={`${selectedProfile.name} reference`} />
                <small>Uses the selected profile image. No upload required.</small>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="settings-actions">
          <button type="button" className="primary-button" onClick={startSession} disabled={state === "Connecting" || (state === "Live" && activeVideoMode === videoMode)}>Start experience</button>
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
          <ProfileSelector selectedId={selectedProfileId} onSelect={selectProfile} />
          <div className="conversation-intro">
            <h1>{INITIAL_ASSISTANT_MESSAGE}</h1>
          </div>
          <div ref={conversationHistoryRef} className="conversation-history" role="log" aria-live="polite">
            {conversation.filter((message, index) => !(index === 0 && message.role === "assistant" && message.content === INITIAL_ASSISTANT_MESSAGE)).map((message, index) => (
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
              showBranding={!generatedInstruction && !(videoMode === "director" && sessionActive)}
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
