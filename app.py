from pathlib import Path
import logging
import os
from functools import lru_cache

import uvicorn
from dotenv import load_dotenv
from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = Path(__file__).resolve().parent
logger = logging.getLogger(__name__)
load_dotenv(BASE_DIR / ".env")
DEMO_MODE = (
    os.getenv("DEMO_MODE", "false").strip().lower()
    in {"1", "true", "yes", "on"}
)


@lru_cache(maxsize=1)
def _live_backend():
    """Load the credential-backed graph only when live mode is used."""
    import nest_asyncio

    nest_asyncio.apply()
    from backend import resume_travel_agent, run_travel_agent

    return run_travel_agent, resume_travel_agent

app = FastAPI(
    title="TripMate AI",
    description=(
        "LangGraph Multi-Agent Travel Planner with Supervisor, Guardrails, "
        "Human-in-the-Loop, and FastAPI Frontend"
    ),
    version="2.0.0",
)

SESSION_SECRET = os.getenv("SESSION_SECRET", "").strip()
SESSION_SECRET_CONFIGURED = bool(SESSION_SECRET)
if not SESSION_SECRET_CONFIGURED:
    # Local development fallback only. Set a unique random value in production.
    SESSION_SECRET = "local-only-change-me-before-deploying-tripmate"
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=os.getenv("SESSION_COOKIE_SECURE", "false").strip().lower()
    in {"1", "true", "yes", "on"},
)

GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://127.0.0.1:8000").strip().rstrip("/")
AUTH_CONFIGURED = bool(
    GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET and SESSION_SECRET_CONFIGURED
)
oauth = OAuth()
if GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=GOOGLE_OAUTH_CLIENT_ID,
        client_secret=GOOGLE_OAUTH_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


def page_context(request: Request) -> dict:
    return {
        "demo_mode": DEMO_MODE,
        "google_maps_api_key": os.getenv("GOOGLE_MAPS_API_KEY", "").strip(),
        "user": request.session.get("user"),
        "auth_configured": AUTH_CONFIGURED,
    }

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class TravelRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10_000)
    thread_id: str | None = Field(default=None, max_length=128)


class ApprovalRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128)
    approved: bool
    feedback: str = Field(default="", max_length=5_000)


class PDFRequest(BaseModel):
    content: str = Field(min_length=1, max_length=50_000)


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context=page_context(request),
    )


@app.get("/signup", response_class=HTMLResponse)
async def signup_page(request: Request):
    context = page_context(request)
    context["error"] = request.query_params.get("error", "")
    context["app_base_url"] = APP_BASE_URL
    return templates.TemplateResponse(
        request=request,
        name="signup.html",
        context=context,
    )


@app.get("/auth/google")
async def google_login(request: Request):
    if not AUTH_CONFIGURED:
        return RedirectResponse(url="/signup?error=not-configured", status_code=303)
    redirect_uri = f"{APP_BASE_URL}/auth/google/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@app.get("/auth/google/callback", name="google_callback")
async def google_callback(request: Request):
    if not AUTH_CONFIGURED:
        return RedirectResponse(url="/signup?error=not-configured", status_code=303)
    try:
        token = await oauth.google.authorize_access_token(request)
        profile = token.get("userinfo") or {}
        subject = profile.get("sub")
        email = profile.get("email")
        if not subject or not email or not profile.get("email_verified", False):
            return RedirectResponse(url="/signup?error=unverified", status_code=303)
        request.session.clear()
        request.session["user"] = {
            "sub": str(subject),
            "email": str(email),
            "name": str(profile.get("name") or email),
            "picture": str(profile.get("picture") or ""),
        }
        return RedirectResponse(url="/", status_code=303)
    except OAuthError:
        logger.exception("Google OAuth callback failed")
        return RedirectResponse(url="/signup?error=oauth", status_code=303)


@app.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/", status_code=303)


@app.post("/api/travel")
async def travel_planner(request_data: TravelRequest):
    try:
        user_message = request_data.message.strip()

        if not user_message:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Message cannot be empty.",
                },
            )

        if DEMO_MODE:
            from demo_mode import run_travel_agent
        else:
            run_travel_agent, _ = _live_backend()

        result = run_travel_agent(
            user_input=user_message,
            thread_id=request_data.thread_id,
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        logger.exception("Travel planning request failed")

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "The travel planning request could not be completed. Check the server logs for details.",
            },
        )


@app.post("/api/travel/approve")
async def approve_travel_plan(request_data: ApprovalRequest):
    try:
        if not request_data.approved and not request_data.feedback.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Please provide revision feedback when rejecting the draft.",
                },
            )

        if DEMO_MODE:
            from demo_mode import resume_travel_agent
        else:
            _, resume_travel_agent = _live_backend()

        result = resume_travel_agent(
            thread_id=request_data.thread_id,
            approved=request_data.approved,
            feedback=request_data.feedback,
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        logger.exception("Travel approval request failed")

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "The travel plan could not be resumed. Check the server logs for details.",
            },
        )


@app.post("/api/travel/pdf")
async def export_travel_plan(request_data: PDFRequest):
    try:
        from pdf_export import build_travel_pdf

        pdf_content = build_travel_pdf(request_data.content)
        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="tripmate-ai-travel-plan.pdf"',
                "Cache-Control": "no-store",
            },
        )
    except Exception:
        logger.exception("Travel plan PDF export failed")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "The PDF could not be generated. Please try again.",
            },
        )


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "TripMate AI API is running",
        "mode": "demo" if DEMO_MODE else "live",
        "features": [
            "supervisor_agent",
            "input_guardrail",
            "human_in_the_loop",
        ],
    }


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
