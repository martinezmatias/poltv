export type CatalogCandidate = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  year: number | null;
  genres: string[];
  overview: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  original_language: string;
  poster_path: string | null;
  backdrop_path: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  runtime_minutes?: number | null;
  watch_providers?: WatchProviderAvailability | null;
};

export type WatchProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  logo_url: string | null;
  display_priority: number | null;
};

export type WatchProviderAvailability = {
  country: string;
  link: string | null;
  flatrate: WatchProvider[];
  free: WatchProvider[];
  ads: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
};
