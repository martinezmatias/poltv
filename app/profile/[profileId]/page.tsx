"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { VIEWER_PROFILES } from "../../../config/profiles";
import { RecommendationRail } from "../../components/RecommendationRail";
import type { CatalogCandidate } from "../../components/types";

type SavedItem = Partial<CatalogCandidate> & Pick<CatalogCandidate, "tmdb_id" | "media_type" | "title">;

const toCandidate = (item: SavedItem): CatalogCandidate => ({
  tmdb_id: item.tmdb_id,
  media_type: item.media_type,
  title: item.title,
  year: item.year ?? null,
  genres: item.genres ?? [],
  overview: item.overview ?? "",
  popularity: item.popularity ?? 0,
  vote_average: item.vote_average ?? 0,
  vote_count: item.vote_count ?? 0,
  original_language: item.original_language ?? "",
  poster_path: item.poster_path ?? null,
  backdrop_path: item.backdrop_path ?? null,
  poster_url: item.poster_url ?? null,
  backdrop_url: item.backdrop_url ?? null,
});

export default function ProfilePage() {
  const params = useParams<{ profileId: string }>();
  const profileId = params.profileId;
  const profile = VIEWER_PROFILES.find((item) => item.id === profileId);
  const [items, setItems] = useState<CatalogCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aroundPoltvPrivate, setAroundPoltvPrivate] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);

  const loadItems = useCallback(() => {
    setLoading(true);
    void fetch(`/api/my-list?profileId=${encodeURIComponent(profileId)}`)
      .then(async (response) => {
        const payload = await response.json() as { items?: SavedItem[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "My List could not be loaded.");
        return payload.items ?? [];
      })
      .then((saved) => {
        setItems(saved.map(toCandidate));
        setError(null);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "My List could not be loaded."))
      .finally(() => setLoading(false));
  }, [profileId]);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setTimeout(loadItems, 0);
    return () => window.clearTimeout(timer);
  }, [profile, loadItems]);

  useEffect(() => {
    if (!profile) return;
    void fetch(`/api/profile-settings?profileId=${encodeURIComponent(profileId)}`)
      .then(async (response) => {
        const payload = await response.json() as { around_poltv_private?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Profile settings could not be loaded.");
        return payload;
      })
      .then((settings) => setAroundPoltvPrivate(settings.around_poltv_private === true))
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Profile settings could not be loaded."));
  }, [profile, profileId]);

  const updatePrivacy = (privateValue: boolean) => {
    const previous = aroundPoltvPrivate;
    setAroundPoltvPrivate(privateValue);
    setPrivacySaving(true);
    void fetch("/api/profile-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, around_poltv_private: privateValue }),
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "Profile privacy could not be saved.");
      }
    }).catch((nextError) => {
      setAroundPoltvPrivate(previous);
      setError(nextError instanceof Error ? nextError.message : "Profile privacy could not be saved.");
    }).finally(() => setPrivacySaving(false));
  };

  const savedKeys = useMemo(() => new Set(items.map((item) => `${item.media_type}-${item.tmdb_id}`)), [items]);

  const removeItem = (candidate: CatalogCandidate) => {
    const previous = items;
    setItems((current) => current.filter((item) => `${item.media_type}-${item.tmdb_id}` !== `${candidate.media_type}-${candidate.tmdb_id}`));
    void fetch("/api/my-list", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, tmdb_id: candidate.tmdb_id, media_type: candidate.media_type }),
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "Unable to remove recommendation.");
      }
    }).catch((nextError) => {
      setItems(previous);
      setError(nextError instanceof Error ? nextError.message : "Unable to remove recommendation.");
    });
  };

  if (!profile) {
    return <main className="profile-page"><Link className="profile-back-link" href="/">← Back to PolTV</Link><h1>Profile not found</h1></main>;
  }

  return (
    <main className="profile-page">
      <header className="profile-page-header">
        <Link className="profile-back-link" href="/">← Back to PolTV</Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="profile-page-avatar" src={profile.image} alt={profile.name} />
        <p className="eyebrow">Your profile</p>
        <h1>{profile.name}</h1>
      </header>
      <section className="my-list-section" aria-labelledby="my-list-title">
        <h2 id="my-list-title">My Picks<span className="my-list-subtitle">, saved from Pol’s recommendations</span></h2>
        <label className="privacy-setting">
          <input type="checkbox" checked={aroundPoltvPrivate} onChange={(event) => updatePrivacy(event.target.checked)} disabled={privacySaving} />
          <span><strong>Keep my recommendations private</strong><small>Hide my recommendations from Around PolTV.</small></span>
        </label>
        {loading ? <p className="muted">Loading your list…</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="profile-empty-state">Your picks are empty. Save movies and series from Pol’s recommendations to find them here.</p>
        ) : null}
        {error ? <p className="error-note" role="alert">{error}</p> : null}
        {!loading && items.length > 0 ? (
          <RecommendationRail
            recommendations={items}
            onSelect={() => undefined}
            savedKeys={savedKeys}
            onToggleSave={removeItem}
            heading=""
          />
        ) : null}
      </section>
    </main>
  );
}
