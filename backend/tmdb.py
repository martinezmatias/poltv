from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx

from backend.main_types import CatalogCandidate, CatalogQuery


TMDB_BASE_URL = "https://api.themoviedb.org/3"
REQUEST_TIMEOUT_SECONDS = 15.0


class TMDBError(RuntimeError):
    pass


class TMDBClient:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token
        self._genre_cache: Dict[str, Dict[str, int]] = {}
        self._details_cache: Dict[Tuple[str, int], Dict[str, Any]] = {}

    def _image_configuration(self) -> Tuple[str, List[str], List[str]]:
        try:
            images = self._request("/configuration").get("images", {})
            base_url = images.get("secure_base_url") or images.get("base_url")
            poster_sizes = images.get("poster_sizes")
            backdrop_sizes = images.get("backdrop_sizes")
            if isinstance(base_url, str) and isinstance(poster_sizes, list) and isinstance(backdrop_sizes, list):
                return base_url, [str(size) for size in poster_sizes], [str(size) for size in backdrop_sizes]
        except TMDBError:
            pass
        return "https://image.tmdb.org/t/p/", ["w500", "original"], ["w780", "w1280", "original"]

    @staticmethod
    def _image_url(base_url: str, sizes: List[str], path: Optional[str], preferred_size: str) -> Optional[str]:
        if not path:
            return None
        size = preferred_size if preferred_size in sizes else (sizes[0] if sizes else "original")
        return f"{base_url}{size}{path}"

    def _request(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        try:
            response = httpx.get(
                f"{TMDB_BASE_URL}{path}",
                params=params or {},
                headers={"Authorization": f"Bearer {self.access_token}"},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise TMDBError("TMDB network request failed") from exc

        if response.status_code in (401, 403):
            raise TMDBError("TMDB authentication failed")
        if response.status_code >= 400:
            raise TMDBError(f"TMDB request failed with status {response.status_code}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise TMDBError("TMDB returned malformed JSON") from exc
        if not isinstance(payload, dict):
            raise TMDBError("TMDB returned an invalid response")
        return payload

    def _genres(self, media_type: str) -> Dict[str, int]:
        if media_type in self._genre_cache:
            return self._genre_cache[media_type]
        payload = self._request(f"/genre/{media_type}/list", {"language": "en-US"})
        genres = payload.get("genres")
        if not isinstance(genres, list):
            raise TMDBError("TMDB returned an invalid genre response")
        result = {
            str(item["name"]).casefold(): int(item["id"])
            for item in genres
            if isinstance(item, dict) and item.get("name") is not None and item.get("id") is not None
        }
        self._genre_cache[media_type] = result
        return result

    def _search(self, media_type: str, title_query: str) -> List[Dict[str, Any]]:
        payload = self._request(f"/search/{media_type}", {"query": title_query, "include_adult": False})
        results = payload.get("results")
        return results if isinstance(results, list) else []

    def _similar(self, media_type: str, item_id: int) -> List[Dict[str, Any]]:
        path = f"/movie/{item_id}/similar" if media_type == "movie" else f"/tv/{item_id}/similar"
        payload = self._request(path)
        results = payload.get("results")
        return results if isinstance(results, list) else []

    def _details(self, media_type: str, item_id: int) -> Dict[str, Any]:
        key = (media_type, item_id)
        if key not in self._details_cache:
            path = f"/movie/{item_id}" if media_type == "movie" else f"/tv/{item_id}"
            self._details_cache[key] = self._request(path, {"language": "en-US"})
        return self._details_cache[key]

    def _discover(self, media_type: str, query: CatalogQuery) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"include_adult": False, "sort_by": "popularity.desc"}
        if query.genres:
            genre_ids = [self._genres(media_type).get(genre.casefold()) for genre in query.genres]
            genre_ids = [genre_id for genre_id in genre_ids if genre_id is not None]
            if genre_ids:
                params["with_genres"] = "|".join(str(genre_id) for genre_id in genre_ids)

        if media_type == "movie":
            date_field = "primary_release_date"
        else:
            date_field = "first_air_date"
        if query.year_from:
            params[f"{date_field}.gte"] = f"{query.year_from}-01-01"
        if query.year_to:
            params[f"{date_field}.lte"] = f"{query.year_to}-12-31"

        payload = self._request(f"/discover/{media_type}", params)
        results = payload.get("results")
        return results if isinstance(results, list) else []

    @staticmethod
    def _date_year(value: Any) -> Optional[int]:
        if not isinstance(value, str) or len(value) < 4:
            return None
        try:
            return date.fromisoformat(value[:10]).year
        except ValueError:
            return None

    def _normalize(
        self,
        item: Dict[str, Any],
        media_type: str,
        genres: Dict[str, int],
        image_configuration: Tuple[str, List[str], List[str]],
    ) -> Optional[CatalogCandidate]:
        item_id = item.get("id")
        title = item.get("title") or item.get("name")
        if not isinstance(item_id, int) or not isinstance(title, str) or not title.strip():
            return None

        genre_ids = item.get("genre_ids") or []
        genre_names = [
            name for name, genre_id in genres.items() if genre_id in genre_ids
        ]
        if not genre_names and isinstance(item.get("genres"), list):
            genre_names = [
                str(genre.get("name")).strip()
                for genre in item["genres"]
                if isinstance(genre, dict) and genre.get("name")
            ]
        release_date = item.get("release_date") or item.get("first_air_date")
        poster_path = item.get("poster_path") if isinstance(item.get("poster_path"), str) else None
        backdrop_path = item.get("backdrop_path") if isinstance(item.get("backdrop_path"), str) else None
        base_url, poster_sizes, backdrop_sizes = image_configuration
        return CatalogCandidate(
            tmdb_id=item_id,
            media_type=media_type,
            title=title.strip(),
            year=self._date_year(release_date),
            genres=genre_names[:8],
            overview=str(item.get("overview") or "").strip(),
            popularity=float(item.get("popularity") or 0),
            vote_average=float(item.get("vote_average") or 0),
            vote_count=int(item.get("vote_count") or 0),
            original_language=str(item.get("original_language") or ""),
            poster_path=poster_path,
            backdrop_path=backdrop_path,
            poster_url=self._image_url(base_url, poster_sizes, poster_path, "w500"),
            backdrop_url=self._image_url(base_url, backdrop_sizes, backdrop_path, "w780"),
        )

    def _enrich_runtime(self, candidate: CatalogCandidate) -> CatalogCandidate:
        try:
            details = self._details(candidate.media_type, candidate.tmdb_id)
            if candidate.media_type == "movie":
                runtime = details.get("runtime")
            else:
                runtimes = details.get("episode_run_time")
                runtime = runtimes[0] if isinstance(runtimes, list) and runtimes else None
            runtime_minutes = int(runtime) if isinstance(runtime, (int, float)) and runtime > 0 else None
            return candidate.model_copy(update={"runtime_minutes": runtime_minutes})
        except (TMDBError, TypeError, ValueError):
            return candidate

    def get_candidate(self, media_type: str, item_id: int) -> Optional[CatalogCandidate]:
        details = self._details(media_type, item_id)
        candidate = self._normalize(details, media_type, self._genres(media_type), self._image_configuration())
        return self._enrich_runtime(candidate) if candidate else None

    def _normalize_many(
        self,
        items: Iterable[Dict[str, Any]],
        media_type: str,
        image_configuration: Tuple[str, List[str], List[str]],
    ) -> List[CatalogCandidate]:
        genres = self._genres(media_type)
        normalized: List[CatalogCandidate] = []
        seen: set[tuple[str, int]] = set()
        for item in items:
            candidate = self._normalize(item, media_type, genres, image_configuration)
            if candidate is None or (candidate.media_type, candidate.tmdb_id) in seen:
                continue
            seen.add((candidate.media_type, candidate.tmdb_id))
            normalized.append(candidate)
        return normalized

    def retrieve(self, query: CatalogQuery) -> List[CatalogCandidate]:
        media_types = ["movie", "tv"] if query.media_type == "both" else [query.media_type]
        candidates: List[CatalogCandidate] = []
        image_configuration = self._image_configuration()

        for media_type in media_types:
            if query.title_query:
                search_results = self._search(media_type, query.title_query)
                if search_results:
                    candidates.extend(self._normalize_many(search_results[:1], media_type, image_configuration))
                    anchor_id = search_results[0].get("id")
                    if isinstance(anchor_id, int):
                        candidates.extend(
                            self._normalize_many(self._similar(media_type, anchor_id)[:5], media_type, image_configuration)
                        )
            else:
                candidates.extend(
                    self._normalize_many(self._discover(media_type, query)[:6], media_type, image_configuration)
                )

        unique: List[CatalogCandidate] = []
        seen: set[tuple[str, int]] = set()
        for candidate in candidates:
            key = (candidate.media_type, candidate.tmdb_id)
            if key not in seen:
                seen.add(key)
                unique.append(candidate)
        return [self._enrich_runtime(candidate) for candidate in unique[:8]]
