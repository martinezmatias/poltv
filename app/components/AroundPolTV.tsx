"use client";

import { useEffect, useState } from "react";
import { VIEWER_PROFILES } from "../../config/profiles";
import { RecommendationDetailsModal } from "./RecommendationDetailsModal";
import type { CatalogCandidate } from "./types";

type RecommendationActivity = {
  event_id: string;
  user_id: string;
  user_name: string;
  query_summary: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  year: number | null;
  poster_url: string | null;
  timestamp: string;
};

type AroundPolTVProps = {
  apiUrl: string;
  activeProfileId: string;
  visible: boolean;
  refreshKey: number;
  savedKeys: Set<string>;
  onToggleSave: (candidate: CatalogCandidate) => void;
  onStatus?: (status: string) => void;
};

export function AroundPolTV({ apiUrl, activeProfileId, visible, refreshKey, savedKeys, onToggleSave, onStatus }: AroundPolTVProps) {
  const [activities, setActivities] = useState<RecommendationActivity[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailActivity, setDetailActivity] = useState<RecommendationActivity | null>(null);
  const [detailCandidate, setDetailCandidate] = useState<CatalogCandidate | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/around-poltv?exclude_profile_id=${encodeURIComponent(activeProfileId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Around PolTV unavailable");
        return response.json() as Promise<RecommendationActivity[]>;
      })
      .then((nextActivities) => {
        if (!active) return;
        const eligibleActivities = nextActivities.filter((activity) => activity.user_id !== activeProfileId);
        setActivities(eligibleActivities);
        setIndex(0);
        onStatus?.(eligibleActivities.length > 0
          ? `Visible: ${eligibleActivities.length} eligible event${eligibleActivities.length === 1 ? "" : "s"}.`
          : `Hidden: no recommendations from other profiles for ${activeProfileId}.`);
      })
      .catch(() => {
        if (active) {
          setActivities([]);
          onStatus?.("Unavailable: the Around PolTV service could not be reached.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeProfileId, apiUrl, onStatus, refreshKey]);

  useEffect(() => {
    if (!visible || activities.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % activities.length), 8000);
    return () => window.clearInterval(timer);
  }, [activities.length, visible]);

  if (!visible || loading || activities.length === 0) return null;
  const activity = activities[index % activities.length];
  const profile = VIEWER_PROFILES.find((item) => item.id === activity.user_id);
  const activityCandidate: CatalogCandidate = {
    tmdb_id: activity.tmdb_id,
    media_type: activity.media_type,
    title: activity.title,
    year: activity.year,
    genres: [],
    overview: "",
    popularity: 0,
    vote_average: 0,
    vote_count: 0,
    original_language: "",
    poster_path: null,
    backdrop_path: null,
    poster_url: activity.poster_url,
    backdrop_url: null,
    runtime_minutes: null,
  };
  const openActivity = (selectedActivity: RecommendationActivity) => {
    const fallbackCandidate: CatalogCandidate = {
      ...activityCandidate,
      tmdb_id: selectedActivity.tmdb_id,
      media_type: selectedActivity.media_type,
      title: selectedActivity.title,
      year: selectedActivity.year,
      poster_url: selectedActivity.poster_url,
    };
    setDetailActivity(selectedActivity);
    setDetailCandidate(fallbackCandidate);
    void fetch(`${apiUrl}/catalog-item?media_type=${encodeURIComponent(selectedActivity.media_type)}&tmdb_id=${selectedActivity.tmdb_id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalog details unavailable");
        return response.json() as Promise<CatalogCandidate>;
      })
      .then((candidate) => setDetailCandidate((current) => current?.tmdb_id === selectedActivity.tmdb_id && current.media_type === selectedActivity.media_type ? candidate : current))
      .catch(() => undefined);
  };

  return (
    <>
      <section className="around-poltv" aria-label="Around PolTV">
      <div className="around-heading">
        <span className="around-heading-label">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="around-poltv-icon" src="/resources/aroundPolTV.png?v=1" alt="" />
          <span className="eyebrow">Around PolTV</span>
        </span>
        {activities.length > 1 ? (
          <div className="around-controls">
            <button type="button" onClick={() => setIndex((current) => (current - 1 + activities.length) % activities.length)} aria-label="Previous activity">←</button>
            <button type="button" onClick={() => setIndex((current) => (current + 1) % activities.length)} aria-label="Next activity">→</button>
          </div>
        ) : null}
      </div>
      <article
        className="around-card around-card-clickable"
        key={activity.event_id}
        role="button"
        tabIndex={0}
        aria-label={`View details for ${activity.title}`}
        onClick={() => openActivity(activity)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openActivity(activity);
          }
        }}
      >
        {profile ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="around-avatar" src={profile.image} alt="" />
        ) : <span className="around-avatar-fallback" aria-hidden="true">●</span>}
        <p><strong>{activity.user_name}</strong> was looking for <span>{activity.query_summary}</span></p>
        <span className="around-arrow" aria-hidden="true">→</span>
        {activity.poster_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="around-poster" src={activity.poster_url} alt={`${activity.title} poster`} />
        ) : <span className="around-poster poster-placeholder">—</span>}
        <div className="around-title"><strong>{activity.title}</strong><small>Pol&apos;s pick{activity.year ? ` · ${activity.year}` : ""}</small></div>
      </article>
      </section>
      {detailActivity && detailCandidate ? (
        <RecommendationDetailsModal
          candidate={detailCandidate}
          polExplanation={detailActivity?.query_summary}
          saved={savedKeys.has(`${detailCandidate.media_type}-${detailCandidate.tmdb_id}`)}
          onClose={() => { setDetailActivity(null); setDetailCandidate(null); }}
          onToggleSave={onToggleSave}
        />
      ) : null}
    </>
  );
}
