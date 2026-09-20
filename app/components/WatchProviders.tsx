"use client";

import type { CatalogCandidate, WatchProvider } from "./types";

type WatchProvidersProps = {
  candidate: CatalogCandidate;
  compact?: boolean;
};

type ProviderGroup = "flatrate" | "free" | "ads" | "rent" | "buy";

const groups: Array<[ProviderGroup, string]> = [
  ["flatrate", "Included with subscription"],
  ["free", "Free"],
  ["ads", "With ads"],
  ["rent", "Rent"],
  ["buy", "Buy"],
];

function ProviderLogos({ providers }: { providers: WatchProvider[] }) {
  return (
    <span className="watch-provider-logos">
      {providers.slice(0, 4).map((provider) => provider.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={provider.provider_id} src={provider.logo_url} alt={provider.provider_name} title={provider.provider_name} />
      ) : <span className="watch-provider-name" key={provider.provider_id}>{provider.provider_name}</span>)}
    </span>
  );
}

export function WatchProviders({ candidate, compact = false }: WatchProvidersProps) {
  const availability = candidate.watch_providers;
  if (!availability) return null;

  if (compact) {
    const providers = availability.flatrate.length > 0
      ? availability.flatrate
      : [...availability.free, ...availability.ads];
    if (providers.length === 0) return null;
    return (
      <div className="watch-providers watch-providers-compact">
        <span className="watch-providers-label">{availability.flatrate.length > 0 ? "Watch on" : "Available"}</span>
        <ProviderLogos providers={providers} />
      </div>
    );
  }

  const availableGroups = groups.filter(([key]) => availability[key].length > 0);
  if (availableGroups.length === 0) return null;
  return (
    <div className="watch-providers watch-providers-detail">
      <span className="watch-providers-heading">Where to watch in {availability.country}</span>
      {availableGroups.map(([key, label]) => (
        <div className="watch-provider-group" key={key}>
          <span>{label}</span>
          <ProviderLogos providers={availability[key]} />
        </div>
      ))}
      {availability.link ? <a href={availability.link} target="_blank" rel="noreferrer">View availability on TMDB</a> : null}
      <small>Streaming availability powered by JustWatch</small>
    </div>
  );
}
