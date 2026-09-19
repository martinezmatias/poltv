export const VIDEO_CONFIG = {
  directorTestDurationMs: 60_000,
  cinematicClips: {
    textToVideo: {
      endpoint: "minimax/h3-max/text-to-video",
      duration: 10,
      resolution: "480P",
      aspectRatio: "16:9",
      promptExpansionMode: "disabled",
    },
    imageToVideo: {
      endpoint: "minimax/h3-max/image-to-video",
      duration: 10,
      resolution: "768P",
      promptExpansionMode: "disabled",
    },
  },
} as const;
