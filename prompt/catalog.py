RECENT_CANDIDATES_CONTEXT = """
Here are the most recently presented catalog candidates from TMDB. They are part of
the current session context. Use them to understand follow-ups such as "the second
one" or "more like the first". Do not invent titles or metadata outside this list
when referring to these candidates.

{candidates}
""".strip()

ALREADY_RECOMMENDED_CONTEXT = """
These titles have already been recommended during this conversation:
{titles}

ALREADY RECOMMENDED — DO NOT RECOMMEND AGAIN unless the viewer explicitly asks
about one of these titles.

When the viewer asks for another, more specific, darker, funnier, newer, or
otherwise different option, do not recommend these titles again. Treat that as a
request to move to a new title. You may mention or recommend one again only when
the viewer explicitly refers to it, asks to return to it, or asks about it.
""".strip()

PREFERENCE_CONTEXT = """
Accumulated viewer preferences for this conversation:
{preferences}

Use the full accumulated preference context, giving the latest refinement the most
weight. Do not answer a new refinement by merely re-describing the current title.
""".strip()

CATALOG_RESULTS_CONTEXT = """
TMDB retrieval has completed. Use only the compact catalog candidates below when
making factual title recommendations. Do not claim that you searched any other
source. You may interpret the viewer's preferences conversationally, but do not
invent titles, years, genres, ratings, or plot details that are not supported by
these candidates. Recommend one strong match at a time unless the viewer
explicitly asks for several options, and explain only its most relevant connection
to the viewer's request.

Candidate watch-provider data is factual and country-specific. Use it when the
viewer asks where a title is available, but never invent provider availability.

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
