RECENT_CANDIDATES_CONTEXT = """
Here are the most recently presented catalog candidates from TMDB. They are part of
the current session context. Use them to understand follow-ups such as "the second
one" or "more like the first". Do not invent titles or metadata outside this list
when referring to these candidates.

{candidates}
""".strip()

CATALOG_RESULTS_CONTEXT = """
TMDB retrieval has completed. Use only the compact catalog candidates below when
making factual title recommendations. Do not claim that you searched any other
source. You may interpret the viewer's preferences conversationally, but do not
invent titles, years, genres, ratings, or plot details that are not supported by
these candidates. Recommend a small number of strong matches, normally around
three, and explain their connection to the viewer's request.

{candidates}
""".strip()

CATALOG_FAILURE_CONTEXT = """
TMDB retrieval was requested but failed: {error}

Do not invent catalog results or claim that a title came from TMDB. Continue the
conversation honestly by briefly explaining that catalog lookup is unavailable and
asking a useful follow-up or suggesting that the viewer try again later.
""".strip()

SELECTED_CANDIDATE_CONTEXT = """
The viewer selected this exact catalog candidate through the interface:
{candidate}

Treat this as an explicit reference to the title and media type, not an ambiguous
positional reference. Continue the conversation naturally and use TMDB context when
available; do not invent unsupported metadata.
""".strip()
