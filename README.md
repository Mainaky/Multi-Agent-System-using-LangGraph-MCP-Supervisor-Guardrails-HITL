# TripMate AI

TripMate is a travel-planning demo built with FastAPI, LangGraph, Groq, and MCP. A supervisor selects specialist agents for flights, hotels, weather, budgets, and itineraries. The workflow pauses so a person can review a draft before the final response is generated.

## Features

- Supervisor routing and a travel-focused input guardrail
- MCP integrations for Tavily search, AviationStack, and OpenWeather
- PostgreSQL-backed LangGraph checkpoints for resumable plans
- Human review and revision of draft itineraries
- Browser interface with PDF export

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

The PostgreSQL checkpoint tables are created by LangGraph when the backend starts. Live tools require their corresponding API keys; `GROQ_API_KEY` and `DATABASE_URL` are required for the application to start.

## Run the interactive demo (no credentials required)

The demo mode uses deterministic sample itineraries to show the full interface and human-review flow without calling an LLM, PostgreSQL, or external MCP services.

1. Install the Python dependencies: `python -m pip install -r requirements.txt`.
2. Copy `.env.demo.example` to `.env`.
3. Start the server: `uvicorn app:app --reload --host 127.0.0.1 --port 8000`.
4. Open <http://127.0.0.1:8000>, choose a sample prompt, generate a draft, and approve it or request a revision.

The interface labels this mode as a demo and identifies the itinerary content as sample data. Set `DEMO_MODE=false` and configure the values in `.env.example` to use the live integrations.

## Deploy the public demo on Render

The repository includes a `render.yaml` Blueprint for a free Python web service. It sets `DEMO_MODE=true`, uses `/health` for health checks, and does not require a database or API secrets. Connect this public GitHub repository to Render as a Blueprint and deploy the `tripmate-ai-demo` service. Render will assign the service a public `onrender.com` URL.

Render's free web services sleep after 15 minutes without inbound traffic and typically take about one minute to start on the next request. Demo review state is held in process memory, so it is temporary and can disappear after a restart or sleep. This deployment is intended for showcasing, not production use.

## Configuration

| Variable | Purpose | Required |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq chat model access | Yes |
| `DATABASE_URL` | PostgreSQL checkpoint storage | Yes |
| `TAVILY_API_KEY` | Tavily search MCP | For live search |
| `AVIATION_STACK_API_KEY` | AviationStack MCP | For flight data |
| `OPENWEATHER_API_KEY` | Custom weather MCP server | For live weather |

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
- `demo.excalidraw` — workflow diagram

## License

See [LICENSE](LICENSE).
