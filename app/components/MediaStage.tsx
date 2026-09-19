"use client";

import type { ReactNode, RefObject } from "react";
import type { CatalogCandidate } from "./types";
import { RecommendationRail } from "./RecommendationRail";

type MediaStageProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  recommendations: CatalogCandidate[];
  selectedRecommendation: CatalogCandidate | null;
  onSelectRecommendation: (candidate: CatalogCandidate) => void;
  recommendationDisabled?: boolean;
  stageLabel: string;
  settings: ReactNode;
  showControls?: boolean;
};

export function MediaStage({
  videoRef,
  recommendations,
  selectedRecommendation,
  onSelectRecommendation,
  recommendationDisabled,
  stageLabel,
  settings,
  showControls = false,
}: MediaStageProps) {
  const backdrop = selectedRecommendation?.backdrop_url ?? recommendations[0]?.backdrop_url;

  return (
    <div className="media-stage">
      {backdrop ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="stage-backdrop" src={backdrop} alt="" aria-hidden="true" />
      ) : null}
      <div className="stage-wash" aria-hidden="true" />
      <div className="stage-topline">
        <div className="stage-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pol-logo" src="/resources/logo1.png" alt="Pol" />
          <span className="stage-label"><span className="live-dot" />{stageLabel}</span>
        </div>
        <div>{settings}</div>
      </div>
      <video ref={videoRef} className="stage-video" autoPlay playsInline controls={showControls} />
      <div className="stage-caption">
        <span className="eyebrow">Pol presents</span>
        <h1>Find your next world.</h1>
        <p>Tell us the feeling. We&apos;ll find the story.</p>
      </div>
      <RecommendationRail
        recommendations={recommendations}
        onSelect={onSelectRecommendation}
        disabled={recommendationDisabled}
      />
    </div>
  );
}
