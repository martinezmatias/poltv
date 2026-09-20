"use client";

import type { CatalogCandidate } from "./types";

type RecommendationRailProps = {
  recommendations: CatalogCandidate[];
  onSelect: (candidate: CatalogCandidate) => void;
  disabled?: boolean;
  savedKeys?: Set<string>;
  onToggleSave?: (candidate: CatalogCandidate) => void;
  heading?: string;
};

export function RecommendationRail({ recommendations, onSelect, disabled = false, savedKeys, onToggleSave, heading = "For your next watch" }: RecommendationRailProps) {
  if (recommendations.length === 0) return null;

  return (
    <section className="recommendation-rail" aria-label="Recommendations">
      <div className="rail-heading">
        <span className="eyebrow">{heading}</span>
        <span className="rail-count">{recommendations.length} picks</span>
      </div>
      <div className="recommendation-row">
        {recommendations.map((candidate) => (
          <article
            className="recommendation-card"
            key={`${candidate.media_type}-${candidate.tmdb_id}`}
          >
            <button className="recommendation-card-select" type="button" onClick={() => onSelect(candidate)} disabled={disabled}>
              {candidate.poster_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={candidate.poster_url} alt={`${candidate.title} poster`} />
              ) : (
                <span className="poster-placeholder">No poster</span>
              )}
              <span className="card-copy">
                <strong>{candidate.title}</strong>
                <span>{candidate.media_type === "tv" ? "Series" : "Movie"}{candidate.year ? ` · ${candidate.year}` : ""}</span>
              </span>
            </button>
            {onToggleSave ? (
              <button
                type="button"
                className={`save-button${savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? " saved" : ""}`}
                aria-label={savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? `Remove ${candidate.title} from My List` : `Save ${candidate.title} to My List`}
                title={savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? "Remove from My List" : "Save to My List"}
                onClick={() => onToggleSave(candidate)}
              >
                {savedKeys?.has(`${candidate.media_type}-${candidate.tmdb_id}`) ? "🔖" : "♡"}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
