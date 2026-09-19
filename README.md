# BNAHack 2026

An experimental conversational TV prototype. The viewer watches a prerecorded, mocked, cinematic-clip, or live Director visual experience while a Mistral-powered assistant learns what they want to watch. A separate Media Orchestrator may decide that a meaningful visual update would enrich the recommendation conversation.

This repository currently contains:

- Step 1A: start and display a MiniMax H3 Max Director WebRTC stream.
- Step 1B: manually steer the active Director session without restarting it.
- Step 2A: use Mistral through a small FastAPI backend to conduct a recommendation conversation.
- Step 2B: manually select Mock, Cinematic Clips, or Director; Cinematic Clips supports MiniMax H3 Max Text-to-Video and Image-to-Video for independent short clips.
- Step 3A: use TMDB-grounded retrieval for conversational movie and TV recommendations.
- Step 3B: display the current TMDB recommendation set as selectable poster cards.
- Step 3D: separate recommendation reasoning from Media Orchestrator decisions and media execution.

Voice input, persistence, and later roadmap steps are not implemented.

## Architecture

The browser owns the Director session. FastAPI/Mistral never connects to fal directly:

```text
Browser / Next.js
  ├── conversation UI
  ├── Mock video, independent Text-to-Video/Image-to-Video clips, or live Director WebRTC stream
  ├── sends natural-language messages to FastAPI
  └── sends video instructions to the selected visual mode
          │
          ▼
FastAPI / Mistral
  ├── keeps in-memory conversation history by session_id
  ├── retrieves compact TMDB candidates when Mistral requests catalog grounding
  ├── returns recommendation reply, catalog data, and quick suggestions immediately
  └── evaluates media separately through the Media Orchestrator
```

The Recommendation Agent only handles conversation and catalog recommendations. The
Media Orchestrator separately decides whether a meaningful visual update is useful;
the browser harness then executes that backend-neutral instruction through the
manually selected Mock, Cinematic Clips, or Director mode.

The live Director integration uses fal's realtime WMA/WebRTC contract at `minimax/h3-max/director`. The browser uses the server proxy at `/api/fal/proxy`; the fal key is never sent to client code.

## Requirements

- Node.js and npm
- Python 3.9 or newer
- A Mistral API key for the conversational agent
- A fal API key for Director or Cinematic Clips mode

Mock mode can be used to test the UI and conversation without starting a paid Director session, but it still calls Mistral when a user sends a conversational message.

## Installation

Install the frontend dependencies:

```bash
npm install
```

Create or activate the Python virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The repository already includes a `.venv` in the expected location in the development environment, but recreating it is safe if necessary.

## Environment configuration

Copy the example file and fill in the real keys locally:

```bash
cp .env.example .env
```

Set these values in `.env`:

```env
MISTRAL_API_KEY=your_mistral_api_key
MISTRAL_MODEL=mistral-small-latest
TMDB_API_KEY=your_tmdb_read_access_token
FAL_API_KEY=your_fal_api_key
NEXT_PUBLIC_AGENT_API_URL=http://localhost:8000
```

Details:

- `MISTRAL_API_KEY` is read only by FastAPI.
- `MISTRAL_MODEL` is optional; it defaults to `mistral-small-latest`.
- `FAL_API_KEY` is read by the server-side fal proxy. The current project variable is `FAL_API_KEY`; the proxy also accepts `FAL_KEY` as a fallback.
- `NEXT_PUBLIC_AGENT_API_URL` is safe to expose to the browser and defaults to `http://localhost:8000`.
- `TMDB_API_KEY` is read only by FastAPI and should contain the TMDB API Read Access Token used as a Bearer token. `TMDB_READ_ACCESS_TOKEN` is also accepted as an alternative variable name.

Never commit `.env`, `.env.local`, or any file containing real keys. They are ignored by Git.

## Running locally

### Recommended: two terminals

Start the FastAPI agent in terminal 1:

```bash
npm run agent
```

This runs:

```bash
.venv/bin/uvicorn backend.main:app --reload --port 8000
```

Start Next.js in terminal 2:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Verify that FastAPI is running with:

```bash
curl http://localhost:8000/health
```

Expected response shape:

```json
{
  "status": "ok",
  "mistral_configured": "true",
  "tmdb_configured": "true",
  "model": "mistral-small-latest"
}
```

### Combined command

If no other Next.js server is already using port 3000, both services can be started with:

```bash
npm run dev:all
```

If port 3000 is already occupied, use the two-terminal workflow instead. The combined command stops all child processes when either service exits.

## Using the application

### Mock mode

Mock mode is selected by default. It plays:

`public/resources/Polintro.mp4` is used for the opening intro. Mock visual actions use
`public/resources/polconcassette5s.mp4`.

To test the conversation without paying for Director:

1. Select **Mock** in the **Video mode** selector.
2. Click **Start** if you want the mock video playing.
3. The opening assistant message appears immediately:

   ```text
   What do you feel like watching?
   ```

4. Send a natural-language request.
5. FastAPI sends the conversation to Mistral.
6. The assistant reply appears in the conversation.
7. If the Media Orchestrator returns `action=update`, the visual intent is shown in the developer settings and Mock mode logs it without calling fal.

The mock MP4 is fixed, so it does not visually react to generated instructions.

Mock mode still uses Mistral and can use TMDB recommendations, but it never calls fal. This is the recommended mode for testing the conversational and catalog flows without video-generation cost.

### Cinematic Clips mode

Cinematic Clips supports manually selected Text-to-Video and Image-to-Video generation through the existing `/api/fal/proxy` server proxy. It does not open a Director session and does not require continuity between clips.

1. Select **Cinematic Clips**.
2. Click **Start** if you want the prerecorded Pol intro playing while the conversation begins.
3. Continue the Mistral conversation normally.
4. When the Media Orchestrator returns `action=update`, the browser submits its backend-neutral `visual_instruction` using the selected method's settings in `config/video.ts`.
5. While fal processes the request, the UI shows queued/generating status. The completed CDN video replaces the intro or previous clip in the main player.

The conversation remains usable while a clip is generating. A second clip request is ignored until the current one completes.

For **Text-to-Video**, the current development settings are five seconds, 480P, 16:9, and prompt expansion disabled. For **Image-to-Video**, select the method and provide one PNG, JPEG, or WebP reference image. The current settings are five seconds, 768P, and prompt expansion disabled. The generated I2V prompt explicitly asks fal to preserve the reference subject as a recognizable central character in the requested scene. The selected browser `File` is auto-uploaded by the fal client as the documented `image_url` input; it is not persisted by the application. If no image is selected, no fal request is submitted.

See the official [H3 Max Image-to-Video API documentation](https://fal.ai/models/minimax/h3-max/image-to-video/api) for the current request and file-handling contract.

### Live Director mode

To use the real stream:

1. Select **Director** before starting.
2. Click **Start**.
3. Wait for the Director status to become `Live`.
4. Use the conversational input to describe what you want to watch.
5. When the Media Orchestrator returns `action=update`, the browser sends the visual instruction to the existing Director session.
6. Use **Stop Session** to close the WebRTC session and release its resources.

For development cost control, the current test session automatically stops after 60 seconds. Director sessions have fal-specific pricing and minimum charges; check the [current fal Director page](https://fal.ai/h3-max-director) before running live tests.

### Developer raw steering

The existing raw Director steering control remains available under **Developer: raw Director steering**. It is useful for separating Director problems from Mistral-generated instruction problems.

Raw steering uses the same active Director session and does not create a second stream.

## Conversational agent API

FastAPI exposes:

```text
GET  /health
POST /chat
POST /media-orchestrate
```

Request body for `/chat`:

```json
{
  "session_id": "browser-session-id",
  "message": "Something exciting."
}
```

Response body:

```json
{
  "session_id": "browser-session-id",
  "reply": "Action, thriller, adventure... or something else?",
  "suggestions": ["Something funny", "A darker mystery"],
  "needs_catalog": false,
  "catalog_retrieved": false,
  "catalog_candidates": [],
  "conversation_revision": 1
}
```

The browser then calls `/media-orchestrate` independently with the relevant
conversation, catalog, media, backend, reference-image, and revision state. Its
response is:

```json
{
  "session_id": "browser-session-id",
  "action": "update",
  "visual_instruction": "An original lighthearted action adventure in a colorful coastal town...",
  "reason": "The preferences have become specific enough for a visual mood update.",
  "conversation_revision": 3,
  "media_action_id": "..."
}
```

Both responses are validated with Pydantic models. Recommendation replies are not
blocked by orchestration or fal generation. Conversation revisions and media action
IDs prevent stale results from replacing newer media state. Conversation history is
stored in memory only and is lost when FastAPI restarts.

## TMDB catalog grounding

FastAPI uses the TMDB v3 API with a server-side Bearer token. The retrieval layer currently supports movie and TV title search, movie and TV discovery with simple genre/year filters, genre lists for translating structured genre names to TMDB IDs, and similar-title results when a referenced title is resolved.

Mistral first decides whether `needs_catalog` is true and returns a compact `catalog_query`. FastAPI retrieves at most a small normalized candidate set, then sends those candidates to a second Mistral call for the final conversational response. The model is instructed not to invent catalog titles or metadata. Recent candidates are held in memory for the active `session_id`, so follow-ups such as “the second one” can be resolved.

The developer section **TMDB retrieval** exposes the normalized query, retrieval status, errors, and compact candidates without displaying raw TMDB responses. Candidates also include backend-normalized `poster_url` and `backdrop_url` values based on TMDB image configuration.

When retrieval returns candidates, the frontend displays the same candidates as a small horizontal row of selectable cards. Clicking a card sends its TMDB ID, media type, and title to FastAPI alongside a natural-language message, so Mistral receives an unambiguous selection context. The cards do not start video generation and do not use TMDB posters as Image-to-Video inputs.

TMDB poster URLs follow the official [TMDB image URL guidance](https://developer.themoviedb.org/docs/image-basics), using a normal `w500` poster size when available. The interface includes the required notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.”

## Director steering protocol

The initial Director configuration uses `prompt_version: 1`. Subsequent directions use increasing versions:

```json
{
  "type": "prompt",
  "prompt": "...",
  "script_mode": "replace",
  "replan": true,
  "prompt_version": 2
}
```

`replan: true` asks Director to replace pending planned directions at the next undispatched chunk. The frontend logs fal's `prompt_applied` event as the acknowledgement that the direction was accepted for upcoming generation. Acceptance does not mean that the visual change is already visible; buffered content and generation timing still apply.

## Prompt locations

Model prompts are kept outside the application logic:

- `prompt/initial.ts` — initial Director scene.
- `prompt/assistant.ts` — deterministic opening assistant message.
- `prompt/system.py` — Mistral system prompt and backend assistant-message resource.
- `prompt/media_orchestrator.py` — conservative visual-update decision prompt.

## Video configuration

Video-generation settings are centralized in `config/video.ts`. This includes the Cinematic Clips endpoint, duration, resolution, aspect ratio, prompt expansion mode, and the temporary Director test-session duration. Change these values there when experimenting with generation behavior or cost.

## Validation commands

Frontend:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Backend:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/bnahack26-pycache .venv/bin/python -m compileall -q backend prompt
```

The Mistral conversation can be tested without fal by using Mock mode. A useful manual sequence is:

```text
Something exciting.
Action, but something fun rather than serious.
Now make it more mysterious while keeping the same world.
```

The Recommendation Agent should be capable of asking for clarification first. The separate Media Orchestrator conservatively decides whether a visual update is useful; exact timing is intentionally model-dependent.

## Troubleshooting

### `Agent backend unavailable` or `Failed to fetch`

FastAPI is not reachable. Start it in a second terminal:

```bash
npm run agent
```

Then check:

```bash
curl http://localhost:8000/health
```

If `mistral_configured` is `false`, check `MISTRAL_API_KEY` in `.env` and restart FastAPI.

### Agent returns a Mistral error

Check the FastAPI terminal for the upstream error. Common causes include an invalid key, unavailable model, rate limiting, or account restrictions. Confirm the configured model with `/health` or set `MISTRAL_MODEL` in `.env`.

### Director does not start

Confirm that:

- Mock mode is disabled.
- `FAL_API_KEY` is set in `.env`.
- The Next.js server was restarted after changing environment variables.
- The browser log shows a Director connection/configuration error.

### Agent replies but video does not change

Confirm that the page says `Mode: LIVE DIRECTOR`, not `Mode: MOCK`. In Mock mode, generated instructions are intentionally only displayed/logged. In live mode, wait for the fal `prompt_applied` acknowledgement and for the next undispatched video chunk to reach playback.

## Security notes

- Keep Mistral and fal keys server-side.
- Do not use `NEXT_PUBLIC_` for secrets.
- The local fal proxy is intentionally minimal and unauthenticated for development. Protect it with application authentication before deploying it, because requests can incur fal charges.
- Do not commit `.env`, `.env.local`, or generated secret files.

## Current scope

The current implementation intentionally stops at conversational Mistral decisions, TMDB-grounded catalog retrieval/cards, and manually selected Mock, Cinematic Clips, and Director visual modes. Voice, user profiles, persistence, automatic mode routing, and later roadmap steps require separate explicit work.
