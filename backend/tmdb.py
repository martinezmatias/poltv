from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List, Optional

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
        self, item: Dict[str, Any], media_type: str, genres: Dict[str, int]
    ) -> Optional[CatalogCandidate]:
        item_id = item.get("id")
        title = item.get("title") or item.get("name")
        if not isinstance(item_id, int) or not isinstance(title, str) or not title.strip():
            return None

        genre_names = [
            name for name, genre_id in genres.items() if genre_id in (item.get("genre_ids") or [])
        ]
        release_date = item.get("release_date") or item.get("first_air_date")
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
            poster_path=item.get("poster_path") if isinstance(item.get("poster_path"), str) else None,
        )

    def _normalize_many(
        self, items: Iterable[Dict[str, Any]], media_type: str
    ) -> List[CatalogCandidate]:
        genres = self._genres(media_type)
        normalized: List[CatalogCandidate] = []
        seen: set[tuple[str, int]] = set()
        for item in items:
            candidate = self._normalize(item, media_type, genres)
            if candidate is None or (candidate.media_type, candidate.tmdb_id) in seen:
                continue
            seen.add((candidate.media_type, candidate.tmdb_id))
            normalized.append(candidate)
        return normalized

    def retrieve(self, query: CatalogQuery) -> List[CatalogCandidate]:
        media_types = ["movie", "tv"] if query.media_type == "both" else [query.media_type]
        candidates: List[CatalogCandidate] = []

        for media_type in media_types:
            if query.title_query:
                search_results = self._search(media_type, query.title_query)
                if search_results:
                    candidates.extend(self._normalize_many(search_results[:1], media_type))
                    anchor_id = search_results[0].get("id")
                    if isinstance(anchor_id, int):
                        candidates.extend(self._normalize_many(self._similar(media_type, anchor_id)[:5], media_type))
            else:
                candidates.extend(self._normalize_many(self._discover(media_type, query)[:6], media_type))

        unique: List[CatalogCandidate] = []
        seen: set[tuple[str, int]] = set()
        for candidate in candidates:
            key = (candidate.media_type, candidate.tmdb_id)
            if key not in seen:
                seen.add(key)
                unique.append(candidate)
        return unique[:8]
