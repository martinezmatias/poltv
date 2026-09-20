# PolTV

PolTV is a cinematic, conversational movie and series discovery experience. Pol
helps viewers describe what they feel like watching, finds real catalog titles,
and can create original visual interpretations of that viewing experience.

The application is designed for a TV-style presentation:

- conversation and contextual suggestions on the left;
- cinematic media, real recommendation cards, and Around PolTV on the right;
- concise, readable responses suitable for viewing from a distance.

## Features

### Conversational discovery

The language-model-backed recommendation agent:

- handles multi-turn preference refinement;
- keeps responses short and TV-friendly;
- understands references such as “the second one” and “more like the first”;
- accumulates compatible preferences instead of treating every short follow-up as a new conversation;
- avoids repeatedly recommending the same title when the viewer asks for a different option;
- supports movies and TV series;
- retrieves factual candidates from TMDB when catalog grounding is useful;
- provides 0–4 contextual quick suggestions;
- can identify a concrete title commitment separately from a general title mention.

The recommendation agent is independent from visual-media generation. A response is
returned without waiting for a video job to finish.

### Catalog recommendations

TMDB-backed recommendations use normalized catalog data, including:

- title and media type;
- release or first-air year;
- genres;
- poster and backdrop URLs;
- rating;
- overview;
- runtime when available.

Watch-provider availability is also retrieved from TMDB for Spain by default
(`TMDB_WATCH_PROVIDER_COUNTRY=ES`). Subscription providers are shown first, with
additional availability in the details popup when available. The data is powered by
JustWatch and is labelled in the UI.

Recommendations appear as a small horizontal rail. Selecting a poster opens a
metadata popup with Pol’s explanation and a Save to My Picks action.

### My Picks

Viewers can save and remove recommendations for the currently selected profile.
Lists are independent per profile and persist locally across application restarts.

The profile page shows the selected profile’s avatar, name, privacy setting, and
saved **My Picks**. Saved data is kept separately from social recommendation
activity.

### Around PolTV

Around PolTV is a compact social-discovery carousel showing recent recommendations
made to other profiles. It can include the other profile’s avatar, request summary,
poster, and title. The active profile’s own activity is excluded.

Around PolTV is hidden during the opening/idle cinematic state and before actual
recommendations are displayed. A profile can mark its recommendation activity
private, which removes that profile’s events from other users’ Around PolTV feed.

### Cinematic media

The manually selected visual mode remains authoritative:

- **Mock** — uses local media and never calls the paid generation service;
- **Cinematic Clips** — supports Text-to-Video and Image-to-Video;
- **Director** — supports the live H3 Max Director WebRTC session and same-session steering.

The opening experience uses `public/resources/Polintro.mp4`. Mock visual actions use
`public/resources/polconcassette5s.mp4`. While a finite clip is being generated,
`public/resources/polchoosing5s.mp4` is used as the waiting/transition visual.

Text-to-Video updates always include Pol as a meaningful character, normally as the
protagonist. Image-to-Video uses the selected profile’s existing image as the
reference; no upload flow is used. The viewer remains the grounded subject, while
Pol may appear as a companion or supporting character.

Generated media is original. Real titles can provide broad genre, tone, setting,
and pacing inspiration, but generated scenes must not recreate copyrighted scenes,
actors, protected characters, posters, or dialogue.

The Media Orchestrator independently decides whether a visual update adds value.
It is conservative during early preference gathering, strongly considers the first
substantive recommendation moment and concrete title commitments, and avoids
duplicate or stale generations. Aggressive Generation is available as a development
policy for testing progressive visual evolution.

Finite generated clips continue the conversation asynchronously after playback when
appropriate. Duplicate continuation and stale-generation protections prevent old
media results from corrupting newer conversation state.

### Voice input

The chat includes optional browser speech recognition using the Web Speech API. It
is single-turn, places the transcription into the existing text input, and never
sends automatically. Unsupported browsers and denied microphone permissions leave
normal typed chat available.

## Architecture

```text
Browser / Next.js
  ├── TV-oriented conversation UI
  ├── profile selector and My Picks interaction
  ├── TMDB recommendation cards and metadata popup
  ├── Around PolTV carousel
  ├── Mock, Cinematic Clips, and Director presentation
  └── sends conversation and orchestration requests to FastAPI
          │
          ▼
FastAPI backend
  ├── language-model recommendation conversation
  ├── controlled TMDB retrieval and normalization
  ├── Media Orchestrator decision
  ├── profile-aware My Picks and Around PolTV persistence helpers
  └── server-side fal proxy integration
```

The recommendation agent decides what to say and recommend. The Media Orchestrator
decides whether the visual experience should react. The application harness executes
the manually selected visual mode and owns asynchronous generation, revision IDs,
stale-result suppression, and media lifecycle state.

Credentials for the language model, TMDB, and fal remain server-side. The browser
does not receive those secrets.

## Requirements

- Node.js and npm
- Python 3.9 or newer
- a language-model API key
- a TMDB API Read Access Token for catalog grounding
- a fal API key for Cinematic Clips or Director mode

Mock mode can be used for UI and conversation testing without paid fal generation.
It still uses the language model and may query TMDB.

## Installation

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set the local environment values in `.env`:

```env
MISTRAL_API_KEY=your_language_model_api_key
MISTRAL_MODEL=mistral-small-latest
TMDB_API_KEY=your_tmdb_read_access_token
FAL_API_KEY=your_fal_api_key
NEXT_PUBLIC_AGENT_API_URL=http://localhost:8000
TMDB_WATCH_PROVIDER_COUNTRY=ES
```

The backend currently reads `MISTRAL_API_KEY` and `MISTRAL_MODEL` for the configured
language-model provider. Those names are implementation configuration keys and may
be replaced if the provider adapter changes.

`TMDB_READ_ACCESS_TOKEN` is also accepted as an alternative to `TMDB_API_KEY`.
`FAL_KEY` is accepted as a fallback for `FAL_API_KEY` by the fal proxy.

Never commit `.env`, `.env.local`, or real credentials.

## Running locally

### Two terminals

Start the backend:

```bash
npm run agent
```

Start the frontend in another terminal:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Check the backend:

```bash
curl http://localhost:8000/health
```

### Combined command

```bash
npm run dev:all
```

This starts Next.js and FastAPI together. Press `Ctrl+C` to stop both services.
If either service was previously started separately, stop it first so ports 3000 and
8000 are available.

## Demo data and persistence

The application uses local JSON persistence for prototype data:

- `data/users/<profile-id>.json` — each profile’s My Picks;
- `data/profile-settings/<profile-id>.json` — profile privacy settings;
- `data/around-poltv.json` — recent social recommendation activity.

Seed realistic saved movies for every configured profile:

```bash
npm run seed:lists
```

The seed command resolves real movie metadata through TMDB, assigns a profile-specific
movie pool, and also prepares a small Around PolTV demo feed. It is idempotent for
the saved-list contents and does not run automatically at startup.

Clear only My Picks while preserving profiles and social activity:

```bash
npm run clear:lists
```

The clear command does not remove Around PolTV activity, profile settings, avatars,
or other application data.

## Backend endpoints

```text
GET  /health
POST /chat
POST /media-orchestrate
GET  /around-poltv?exclude_profile_id=<id>
GET  /catalog-item?media_type=movie|tv&tmdb_id=<id>
```

The frontend also uses Next.js routes for local My Picks, profile settings, the fal
proxy, and generated-video saving.

## Configuration and prompts

Video settings are centralized in `config/video.ts`, including:

- Text-to-Video endpoint, duration, resolution, aspect ratio, and prompt expansion;
- Image-to-Video endpoint, duration, resolution, and prompt expansion;
- Director development-session duration.

Prompt resources are kept separate from application logic:

- `prompt/system.py` — recommendation-agent behavior;
- `prompt/catalog.py` — catalog grounding and recommendation context;
- `prompt/media_orchestrator.py` — visual-update decisions and resolved cinematic intent;
- `prompt/media.ts` — backend-specific media prompt construction;
- `prompt/initial.ts` and `prompt/assistant.ts` — opening visual and conversation copy.

The canonical Pol identity is stored in `config/pol.json`.

## Validation

Frontend checks:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Backend checks:

```bash
PYTHONPYCACHEPREFIX=/tmp/poltv-pycache .venv/bin/python -m compileall -q backend prompt
```

For a no-cost visual test, use Mock mode. Confirm that recommendation cards, the
metadata popup, My Picks, Around PolTV, profile switching, voice transcription, and
the opening media all remain usable before testing paid generation modes.

## Security and cost notes

- Keep all API keys server-side.
- Do not use `NEXT_PUBLIC_` for secrets.
- Mock mode never calls paid fal generation.
- The local fal proxy is intended for development and is unauthenticated; protect it
  before deployment because requests can incur provider charges.
- Do not automatically generate video for every conversational turn.
- Do not commit persisted private data or real credentials.

## Current scope

PolTV currently provides conversational catalog discovery, profile-specific My Picks,
Around PolTV social discovery, browser voice-to-text, TMDB-backed visual cards, and
manually selected Mock, Cinematic Clips, and Director visual experiences.

Automatic visual-mode routing, full TV remote navigation, streaming-provider
availability, trailers, voice output, user accounts, watchlists, and advanced identity
consistency remain outside the current prototype scope.
