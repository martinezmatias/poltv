import polConfig from "../config/pol.json";

export type MediaBackend = "mock" | "text-to-video" | "image-to-video" | "director";
export type PolRole = "protagonist" | "companion" | "supporting" | "none";
export type PolIntent = { includePol: boolean; polRole: PolRole };

const ORIGINALITY_RULE = "Keep the scene original: translate any movie reference into broad genre, tone, setting, pacing, and atmosphere. Do not recreate copyrighted characters, actors, scenes, posters, or protected identities.";

export function normalizePolIntent(backend: MediaBackend, includePol: boolean, polRole: PolRole): PolIntent {
  if (backend === "text-to-video") return { includePol: true, polRole: polRole === "none" ? "protagonist" : polRole };
  return { includePol, polRole };
}

export function buildMediaPrompt(
  visualInstruction: string,
  includePol: boolean,
  polRole: PolRole,
  backend: MediaBackend,
): string {
  const instruction = visualInstruction.trim();
  const intent = normalizePolIntent(backend, includePol, polRole);
  if (!intent.includePol || intent.polRole === "none") return `${instruction}\n\n${ORIGINALITY_RULE}`;

  if (backend === "image-to-video") {
    const role = intent.polRole === "protagonist" ? "companion" : intent.polRole;
    return `The person represented by the reference image is the primary visually grounded protagonist. Preserve that person's identity and make them central to the scene. ${polConfig.identity} Pol appears as an original ${role} to the person, accompanying and supporting them without replacing or transforming the reference-image subject. ${instruction}\n\n${ORIGINALITY_RULE}`;
  }

  return `${polConfig.identity} Pol is the ${intent.polRole} of this original cinematic experience. ${instruction}\n\n${ORIGINALITY_RULE}`;
}
