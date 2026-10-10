from pathlib import Path
import logging
import os
from functools import lru_cache

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

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
        context={"demo_mode": DEMO_MODE},
    )


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
