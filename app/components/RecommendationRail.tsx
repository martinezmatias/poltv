"use client";

import type { CatalogCandidate } from "./types";

type RecommendationRailProps = {
  recommendations: CatalogCandidate[];
  onSelect: (candidate: CatalogCandidate) => void;
  disabled?: boolean;
};

export function RecommendationRail({ recommendations, onSelect, disabled = false }: RecommendationRailProps) {
  if (recommendations.length === 0) return null;

  return (
    <section className="recommendation-rail" aria-label="Recommendations">
      <div className="rail-heading">
        <span className="eyebrow">For your next watch</span>
        <span className="rail-count">{recommendations.length} picks</span>
      </div>
      <div className="recommendation-row">
        {recommendations.map((candidate) => (
          <button
            className="recommendation-card"
            type="button"
            key={`${candidate.media_type}-${candidate.tmdb_id}`}
            onClick={() => onSelect(candidate)}
            disabled={disabled}
          >
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
        ))}
      </div>
      <p className="tmdb-attribution">
        <a href="https://www.themoviedb.org/about/logos-attribution" aria-label="TMDB attribution">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="tmdb-logo" src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg" alt="TMDB" />
        </a>{" "}
        This product uses the <a href="https://www.themoviedb.org/">TMDB API</a> but is not endorsed or certified by TMDB.
      </p>
    </section>
  );
}
