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
};
