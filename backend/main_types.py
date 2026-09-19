from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class CatalogQuery(BaseModel):
    media_type: Literal["movie", "tv", "both"] = "both"
    title_query: Optional[str] = None
    genres: List[str] = Field(default_factory=list)
    year_from: Optional[int] = None
    year_to: Optional[int] = None


class CatalogCandidate(BaseModel):
    tmdb_id: int
    media_type: Literal["movie", "tv"]
    title: str
    year: Optional[int] = None
    genres: List[str] = Field(default_factory=list)
    overview: str = ""
    popularity: float = 0
    vote_average: float = 0
    vote_count: int = 0
    original_language: str = ""
    poster_path: Optional[str] = None
