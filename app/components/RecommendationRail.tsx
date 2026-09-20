"use client";

import { useState } from "react";
import type { CatalogCandidate } from "./types";
import { RecommendationDetailsModal } from "./RecommendationDetailsModal";
import { WatchProviders } from "./WatchProviders";

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
                  <WatchProviders candidate={candidate} compact />
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
      {detailCandidate ? (
        <RecommendationDetailsModal
          candidate={detailCandidate}
          polExplanation={polExplanation}
          saved={Boolean(detailIsSaved)}
          onClose={() => setDetailCandidate(null)}
          onToggleSave={(candidate) => onToggleSave?.(candidate)}
        />
      ) : null}
    </>
  );
}
