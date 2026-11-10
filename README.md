# TripMate AI

TripMate is a travel-planning demo built with FastAPI, LangGraph, Groq, and MCP. A supervisor selects specialist agents for flights, hotels, weather, budgets, and itineraries. The workflow pauses so a person can review a draft before the final response is generated.

## Features

- Supervisor routing and a travel-focused input guardrail
- MCP integrations for Tavily search, AviationStack, and OpenWeather
- PostgreSQL-backed LangGraph checkpoints for resumable plans
- Human review and revision of draft itineraries
- Browser interface with PDF export
- Leaflet and OpenStreetMap map, place lookup, nearby accommodation / rail stations / airports, and driving route estimates without a Google Maps key

## Requirements

- Python 3.11 or newer
- PostgreSQL database with a database/user available to the application
- API keys for Groq and the MCP services you plan to use
- `uv` / `uvx` for the AviationStack MCP adapter

## Local setup

1. Clone the repository and enter its directory.
2. Create and activate a virtual environment:

   ```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   ```

3. Install the Python dependencies and `uv`:

   ```powershell
   python -m pip install -r requirements.txt uv
   ```

4. Copy `.env.example` to `.env`, then set the keys and PostgreSQL connection string. Never commit `.env` or real API keys.
5. Start the web application:

   ```powershell
   uvicorn app:app --reload --host 127.0.0.1 --port 8000
   ```

6. Open <http://127.0.0.1:8000>.

The live workflow requires a Groq API key. PostgreSQL is optional: when `DATABASE_URL` is absent, LangGraph uses in-memory checkpoints, which are lost on a Render restart or sleep. The MCP-backed flight, hotel-search, and weather sections use their respective optional API keys; the planner labels unavailable live data rather than inventing it.

## Run the interactive demo (no credentials required)

The demo mode uses a deterministic city- and preference-aware itinerary template to show the full interface and human-review flow without calling an LLM, PostgreSQL, or external MCP services. It is not a live AI response. The interactive map uses public OpenStreetMap-based services and does not require a Google Maps API key; an internet connection is required. When the demo responds to a trip prompt, it also geocodes the destination and, when a city pair is provided, draws the driving route on the map.

1. Install the Python dependencies: `python -m pip install -r requirements.txt`.
2. Copy `.env.demo.example` to `.env`.
3. Start the server: `uvicorn app:app --reload --host 127.0.0.1 --port 8000`.
4. Open <http://127.0.0.1:8000>, choose a sample prompt, generate a draft, and approve it or request a revision.

The interface labels this mode as a demo and identifies the itinerary content as sample data. To use the live model, add a Groq API key, set `DEMO_MODE=false`, and optionally configure `DATABASE_URL` for durable approvals. The app defaults to `openai/gpt-oss-20b`; set `GROQ_MODEL` to another currently supported model if needed. Provider usage limits and charges depend on the account tier and model.

## Deploy the public demo on Render

The repository includes a `render.yaml` Blueprint for a free Python web service. It sets `DEMO_MODE=true` and uses `/health` for health checks. The map needs no Google Maps key: it uses Leaflet, OpenStreetMap tiles, Photon place lookup, Overpass nearby-place data, and OSRM driving routes. Public Photon, Overpass, and OSRM services are best-effort, may throttle requests, and have no uptime guarantee. Keep demo traffic modest; use a hosted provider or self-hosted services for production.

Render's free web services sleep after 15 minutes without inbound traffic and typically take about one minute to start on the next request. Demo review state is held in process memory, so it is temporary and can disappear after a restart or sleep. This deployment is intended for showcasing, not production use.

To turn on model-generated itineraries on Render, add `GROQ_API_KEY` in the service's **Environment** settings and set `DEMO_MODE` to `false`, then save and redeploy. `GROQ_MODEL` defaults to `openai/gpt-oss-20b`. A PostgreSQL `DATABASE_URL` is optional; without it, draft approval state is held in memory and will be lost when the service restarts. The MCP tools fall back to clearly labeled general guidance when their own keys are absent. Check Groq's current [supported models](https://console.groq.com/docs/models), [model deprecations](https://console.groq.com/docs/deprecations), and account pricing/limits before enabling live calls.

### Enable Google sign-in

The app includes a Google OAuth sign-in/sign-up page at `/signup`. First-time Google sign-in creates a TripMate session; the app receives the user's verified name, email, and profile image, but does not store a durable account record or save itineraries to an account database.

1. In Google Cloud Console, create an OAuth client of type **Web application** and configure the OAuth consent screen.
2. Add `https://tripmate-ai-demo.onrender.com` as an authorized JavaScript origin and `https://tripmate-ai-demo.onrender.com/auth/google/callback` as an authorized redirect URI. For local development, use origin `http://127.0.0.1:8000` and redirect URI `http://127.0.0.1:8000/auth/google/callback`.
3. In Render's service environment, set `APP_BASE_URL=https://tripmate-ai-demo.onrender.com`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET`. Render generates `SESSION_SECRET` from the Blueprint; if creating the service manually, set it to a unique random value and set `SESSION_COOKIE_SECURE=true`.
4. Save the variables and redeploy. Never commit the OAuth client secret or paste it into chat.

Google sign-in gives the browser a signed session cookie and does not save the Google access token. The planner endpoints remain publicly callable in this demo and login does not make the app a production account system. Add persistent account storage, per-user itinerary ownership, CSRF protection, and API authorization before using it for private user data.

## Configuration

| Variable | Purpose | Required |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq chat model access when `DEMO_MODE=false` | Required for live AI |
| `GROQ_MODEL` | Groq model ID | Defaults to `openai/gpt-oss-20b` |
| `DATABASE_URL` | PostgreSQL checkpoint storage | Optional; otherwise approvals are in memory |
| `TAVILY_API_KEY` | Tavily search MCP | Optional live hotel/web search |
| `AVIATION_STACK_API_KEY` | AviationStack MCP | Optional flight/airport data |
| `OPENWEATHER_API_KEY` | Custom weather MCP server | For live weather |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth web client ID | Optional; required for Google sign-in |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth web client secret | Optional; required for Google sign-in |
| `SESSION_SECRET` | Random key used to sign the login session cookie | Required to enable Google sign-in |
| `SESSION_COOKIE_SECURE` | Mark the session cookie HTTPS-only | Set `true` for deployed HTTPS |
| `APP_BASE_URL` | Public origin used to construct the OAuth callback URI | Must exactly match the Google Console origin |

The map geocodes a submitted search through Photon (without autocomplete), queries nearby OpenStreetMap accommodation / rail / airport tags through Overpass, and draws driving routes returned by OSRM. OpenStreetMap attribution is shown in the map. Nearby distances are straight-line estimates. OSM data is community-maintained and can be missing or out of date; it does not provide live room rates, availability, room/floor details, or transport fares. Hotel cards can link to a public hotel search and to a listed property website. Confirm booking and fare details with providers. See the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [Photon service notes](https://github.com/komoot/photon#demo-server), and [OSRM demo server policy](https://github-wiki-see.page/m/Project-OSRM/osrm-backend/wiki/Demo-server) before using the public endpoints beyond a small demonstration.

`AVIATIONSTACK_API_KEY` is also accepted as an alias for `AVIATION_STACK_API_KEY`. PostgreSQL connections are configured to require SSL by default unless `sslmode` is already included in `DATABASE_URL`.

## API

- `GET /health` reports application status.
- `POST /api/travel` accepts `{"message": "Plan a week in Japan", "thread_id": null}` and returns a draft that may require review.
- `POST /api/travel/approve` accepts `{"thread_id": "...", "approved": true, "feedback": ""}` to approve or request a revision.
- `POST /api/travel/pdf` accepts `{"content": "## Your itinerary..."}` and returns a paginated, selectable-text PDF attachment.

Requests are limited to 10,000 characters for a prompt, 5,000 characters for review feedback, and 50,000 characters for a PDF. The API returns generic server errors; consult application logs for diagnostic details.

## Docker

Build and run the image after configuring the required environment variables:

```sh
docker build -t tripmate-ai .
docker run --rm -p 8000:8000 --env-file .env tripmate-ai
```

The container needs network access to PostgreSQL and the configured model and MCP services. Do not expose a publicly accessible instance without adding authentication, request throttling, and appropriate deployment controls; the demo API does not authenticate callers.

## Security notes

The input guardrail and model-generated travel advice are demonstrations, not security or travel-safety guarantees. Verify bookings, prices, visa rules, weather, and other time-sensitive details with authoritative sources. API keys belong in environment variables or a local `.env` file, never in source control.

## Project layout

- `app.py` — FastAPI endpoints and page setup
- `backend.py` — LangGraph workflow, agents, and checkpointing
- `mcp_client.py` — MCP connections and tool helpers
- `custom_weather_mcp_server.py` — OpenWeather-backed MCP tools
- `templates/` and `static/` — browser interface
- `static/map.js` — Leaflet/OpenStreetMap place search, driving routes, and nearby hotel / rail / airport discovery
- `demo.excalidraw` — workflow diagram

## License

See [LICENSE](LICENSE).
