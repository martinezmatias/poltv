"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { CatalogCandidate } from "./types";

type RecommendationRailProps = {
  recommendations: CatalogCandidate[];
  onSelect: (candidate: CatalogCandidate) => void;
  disabled?: boolean;
  savedKeys?: Set<string>;
  onToggleSave?: (candidate: CatalogCandidate) => void;
  heading?: string;
  polExplanation?: string;
};

function formatRuntime(candidate: CatalogCandidate) {
  if (!candidate.runtime_minutes) return null;
  if (candidate.media_type === "tv") return `${candidate.runtime_minutes}m/ep`;
  const hours = Math.floor(candidate.runtime_minutes / 60);
  const minutes = candidate.runtime_minutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function metadataLine(candidate: CatalogCandidate) {
  const genres = candidate.genres.slice(0, 2);
  return [candidate.year ? String(candidate.year) : null, ...genres].filter(Boolean).join(" · ");
}

export function RecommendationRail({ recommendations, onSelect, disabled = false, savedKeys, onToggleSave, heading = "For your next watch", polExplanation }: RecommendationRailProps) {
  const [detailCandidate, setDetailCandidate] = useState<CatalogCandidate | null>(null);
  if (recommendations.length === 0) return null;

  const detailIsSaved = detailCandidate ? savedKeys?.has(`${detailCandidate.media_type}-${detailCandidate.tmdb_id}`) : false;

  return (
    <>
      <section className="recommendation-rail" aria-label="Recommendations">
        {heading ? (
          <div className="rail-heading">
            <span className="eyebrow">{heading}</span>
            <span className="rail-count">{recommendations.length} picks</span>
          </div>
        ) : null}
        <div className="recommendation-row">
          {recommendations.map((candidate) => (
            <article className="recommendation-card" key={`${candidate.media_type}-${candidate.tmdb_id}`}>
              <button className="poster-button" type="button" onClick={() => setDetailCandidate(candidate)} aria-label={`View details for ${candidate.title}`}>
                {candidate.poster_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.poster_url} alt={`${candidate.title} poster`} />
                ) : (
                  <span className="poster-placeholder">No poster</span>
                )}
              </button>
              <button className="recommendation-card-select" type="button" onClick={() => onSelect(candidate)} disabled={disabled}>
                <span className="card-copy">
                  <strong>{candidate.title}</strong>
                  <span>{metadataLine(candidate) || (candidate.media_type === "tv" ? "Series" : "Movie")}</span>
                  <span className="card-facts">
                    {candidate.vote_average > 0 ? `★ ${candidate.vote_average.toFixed(1)} TMDB` : null}
                    {formatRuntime(candidate) ? `${candidate.vote_average > 0 ? " · " : ""}${formatRuntime(candidate)}` : null}
                  </span>
                  {candidate.overview ? <span className="card-overview">{candidate.overview}</span> : null}
                </span>
              </button>
              {onToggleSave ? (
                <button
                  type="button"
                  className={`save-button${savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? " saved" : ""}`}
                  aria-label={savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? `Remove ${candidate.title} from My Picks` : `Save ${candidate.title} to My Picks`}
                  title={savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? "Remove from My Picks" : "Save to My Picks"}
                  onClick={() => onToggleSave(candidate)}
                >
                  {savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? "🔖" : "♡"}
                </button>
              ) : null}
            </article>
          ))}
        </div>
        {polExplanation ? <p className="pol-reason"><strong>Pol&apos;s pick</strong><span>{polExplanation}</span></p> : null}
      </section>
      {detailCandidate && typeof document !== "undefined" ? createPortal(
        <div className="recommendation-modal-backdrop" role="presentation" onClick={() => setDetailCandidate(null)}>
          <section className="recommendation-modal" role="dialog" aria-modal="true" aria-labelledby="recommendation-modal-title" onClick={(event) => event.stopPropagation()}>
            <button className="recommendation-modal-close" type="button" onClick={() => setDetailCandidate(null)} aria-label="Close details">×</button>
            <div className="recommendation-modal-content">
              <div className="recommendation-modal-poster-column">
                {detailCandidate.poster_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="recommendation-modal-poster" src={detailCandidate.poster_url} alt={`${detailCandidate.title} poster`} />
                ) : null}
              </div>
              <div className="recommendation-modal-copy">
                <span className="eyebrow">{detailCandidate.media_type === "tv" ? "Series" : "Movie"}</span>
                <h2 id="recommendation-modal-title">{detailCandidate.title}</h2>
                <p className="recommendation-modal-meta">{metadataLine(detailCandidate)}{detailCandidate.vote_average > 0 ? ` · ★ ${detailCandidate.vote_average.toFixed(1)} TMDB` : ""}{formatRuntime(detailCandidate) ? ` · ${formatRuntime(detailCandidate)}` : ""}</p>
                {detailCandidate.overview ? <p className="recommendation-modal-overview">{detailCandidate.overview}</p> : null}
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
              <button type="button" className="primary-button recommendation-modal-save" onClick={() => onToggleSave(detailCandidate)}>
                {detailIsSaved ? "🔖 Remove from My Picks" : "♡ Save to My Picks"}
              </button>
            ) : null}
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
