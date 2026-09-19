import polConfig from "../config/pol.json";

const POL_DESCRIPTION = polConfig.identity.replace(/^Pol is /, "");

export const INITIAL_PROMPT =
  `A continuous original live-action cinematic stream following Pol, ${POL_DESCRIPTION}, browsing an old-fashioned video store filled with shelves of VHS cassettes. Pol wanders curiously between the aisles, examining different movie covers and choosing which movie to watch. The camera follows him naturally at his level as he explores different genres and sections of the store. Warm nostalgic lighting, late-1990s video-store atmosphere, realistic movement, subtle ambient sound, and playful cinematic storytelling. Preserve Pol’s appearance, the video store, and visual continuity throughout the stream. Keep the story open-ended and suitable for future live direction and different movie choices.`;
