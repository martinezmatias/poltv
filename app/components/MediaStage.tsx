"use client";

import type { ReactNode, RefObject } from "react";
import type { CatalogCandidate } from "./types";

type MediaStageProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  recommendations: CatalogCandidate[];
  selectedRecommendation: CatalogCandidate | null;
  stageLabel: string;
  settings: ReactNode;
  showControls?: boolean;
  showBranding?: boolean;
};

export function MediaStage({
  videoRef,
  recommendations,
  selectedRecommendation,
  stageLabel,
  settings,
  showControls = false,
  showBranding = true,
}: MediaStageProps) {
  const backdrop = selectedRecommendation?.backdrop_url ?? recommendations[0]?.backdrop_url;

  return (
    <div className="media-stage">
      {backdrop ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="stage-backdrop" src={backdrop} alt="" aria-hidden="true" />
      ) : null}
      <div className="stage-wash" aria-hidden="true" />
      <div className={`stage-topline${showBranding ? "" : " stage-topline-minimal"}`}>
        {showBranding ? (
          <div className="stage-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pol-logo" src="/resources/logo1.png" alt="Pol" />
            <span className="stage-label"><span className="live-dot" />{stageLabel}</span>
          </div>
        ) : null}
        <div>{settings}</div>
      </div>
      <video ref={videoRef} className="stage-video" autoPlay playsInline controls={showControls} />
      {showBranding ? (
        <div className="stage-caption">
          <h1>Let Pol help you find your film.</h1>
        </div>
      ) : null}
    </div>
  );
}
