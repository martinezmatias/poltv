"use client";

import { useEffect, useState } from "react";
import { VIEWER_PROFILES } from "../../config/profiles";

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
  onStatus?: (status: string) => void;
};

export function AroundPolTV({ apiUrl, activeProfileId, visible, refreshKey, onStatus }: AroundPolTVProps) {
  const [activities, setActivities] = useState<RecommendationActivity[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="around-poltv" aria-label="Around PolTV">
      <div className="around-heading">
        <span className="eyebrow">Around PolTV</span>
        {activities.length > 1 ? (
          <div className="around-controls">
            <button type="button" onClick={() => setIndex((current) => (current - 1 + activities.length) % activities.length)} aria-label="Previous activity">←</button>
            <button type="button" onClick={() => setIndex((current) => (current + 1) % activities.length)} aria-label="Next activity">→</button>
          </div>
        ) : null}
      </div>
      <article className="around-card" key={activity.event_id}>
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
  );
}
