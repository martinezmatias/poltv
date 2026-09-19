"""Smoke test for The Movie Database (TMDB) API."""

import argparse
import json
import os
from pathlib import Path

import requests


TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"


def load_local_env() -> None:
    """Load simple KEY=VALUE entries from .env without adding a dependency."""
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("'\""))


def search_movies(api_key: str, query: str) -> dict:
    response = requests.get(
        TMDB_SEARCH_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        params={"query": query, "include_adult": "false", "language": "en-US"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


if __name__ == "__main__":
    load_local_env()

    parser = argparse.ArgumentParser(description="Search TMDB movies")
    parser.add_argument("query", nargs="?", default="Inception")
    args = parser.parse_args()

    api_key = os.environ.get("TMDB_API_KEY")
    if not api_key:
        raise SystemExit("Add TMDB_API_KEY=your_key_here to .env first.")

    try:
        data = search_movies(api_key, args.query)
        print(json.dumps(data, indent=2, ensure_ascii=False))
    except requests.HTTPError as error:
        body = error.response.text if error.response is not None else str(error)
        raise SystemExit(f"TMDB request failed: {body}") from error
