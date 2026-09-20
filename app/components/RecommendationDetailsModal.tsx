"use client";

import { createPortal } from "react-dom";
import type { CatalogCandidate } from "./types";

type RecommendationDetailsModalProps = {
  candidate: CatalogCandidate;
  polExplanation?: string;
  saved: boolean;
  onClose: () => void;
  onToggleSave?: (candidate: CatalogCandidate) => void;
};

function formatRuntime(candidate: CatalogCandidate) {
  if (!candidate.runtime_minutes) return null;
  if (candidate.media_type === "tv") return `${candidate.runtime_minutes}m/ep`;
  const hours = Math.floor(candidate.runtime_minutes / 60);
  const minutes = candidate.runtime_minutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function metadataLine(candidate: CatalogCandidate) {
  return [candidate.year ? String(candidate.year) : null, ...candidate.genres.slice(0, 2)].filter(Boolean).join(" · ");
}

export function RecommendationDetailsModal({ candidate, polExplanation, saved, onClose, onToggleSave }: RecommendationDetailsModalProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="recommendation-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="recommendation-modal" role="dialog" aria-modal="true" aria-labelledby="recommendation-modal-title" onClick={(event) => event.stopPropagation()}>
        <button className="recommendation-modal-close" type="button" onClick={onClose} aria-label="Close details">×</button>
        <div className="recommendation-modal-content">
          <div className="recommendation-modal-poster-column">
            {candidate.poster_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="recommendation-modal-poster" src={candidate.poster_url} alt={`${candidate.title} poster`} />
            ) : <span className="recommendation-modal-poster poster-placeholder">No poster</span>}
          </div>
          <div className="recommendation-modal-copy">
            <span className="eyebrow">{candidate.media_type === "tv" ? "Series" : "Movie"}</span>
            <h2 id="recommendation-modal-title">{candidate.title}</h2>
            <p className="recommendation-modal-meta">{metadataLine(candidate)}{candidate.vote_average > 0 ? ` · ★ ${candidate.vote_average.toFixed(1)} TMDB` : ""}{formatRuntime(candidate) ? ` · ${formatRuntime(candidate)}` : ""}</p>
            {candidate.overview ? <p className="recommendation-modal-overview">{candidate.overview}</p> : null}
          </div>
        </div>
        {polExplanation ? (
          <div className="recommendation-modal-pol">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="recommendation-modal-pol-icon" src="/resources/logopolwithcicle.png?v=2" alt="PolTV" />
            <div>
              <strong>Pol&apos;s pick</strong>
              <span>{polExplanation}</span>
            </div>
          </div>
        ) : null}
        {onToggleSave ? (
          <button type="button" className="primary-button recommendation-modal-save" onClick={() => onToggleSave(candidate)}>
            {saved ? "🔖 Remove from My Picks" : "♡ Save to My Picks"}
          </button>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
