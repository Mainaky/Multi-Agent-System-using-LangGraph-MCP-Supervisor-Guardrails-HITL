"""Deterministic, credential-free responses for the public-facing demo."""

from __future__ import annotations

import re
import uuid


_sessions: dict[str, dict[str, str]] = {}

_DESTINATIONS = {
    "japan": ("Japan", "Tokyo → Kyoto → Osaka"),
    "tokyo": ("Japan", "Tokyo → Kyoto → Osaka"),
    "kyoto": ("Japan", "Tokyo → Kyoto → Osaka"),
    "thailand": ("Thailand", "Bangkok → Chiang Mai"),
    "bangkok": ("Thailand", "Bangkok → Chiang Mai"),
    "dubai": ("Dubai, UAE", "Downtown Dubai → Old Dubai → Marina"),
    "italy": ("Italy", "Rome → Florence → Venice"),
    "rome": ("Italy", "Rome → Florence → Venice"),
    "paris": ("France", "Paris → Versailles"),
    "france": ("France", "Paris → Versailles"),
    "singapore": ("Singapore", "Marina Bay → Chinatown → Sentosa"),
}


def _destination_for(message: str) -> tuple[str, str]:
    lowered = message.lower()
    for keyword, destination in _DESTINATIONS.items():
        if keyword in lowered:
            return destination

    match = re.search(r"\b(?:to|in|visit)\s+([A-Z][\w-]+(?:\s+[A-Z][\w-]+)?)", message)
    if match:
        place = match.group(1).strip()
        return place, f"{place} city center → local highlights"
    return "your selected destination", "City center → neighborhood highlights"


def _selected_agents(message: str) -> list[str]:
    lowered = message.lower()
    selected = []
    if any(word in lowered for word in ("flight", "fly", "airfare", "airport")):
        selected.append("flight_agent")
    if any(word in lowered for word in ("hotel", "stay", "accommodation")):
        selected.append("hotel_agent")
    if any(word in lowered for word in ("weather", "season", "pack")):
        selected.append("weather_agent")
    if any(word in lowered for word in ("budget", "cost", "price", "under", "cheap")):
        selected.append("budget_agent")
    if not selected:
        selected = ["flight_agent", "hotel_agent", "weather_agent", "budget_agent"]
    selected.append("itinerary_agent")
    return selected


def run_travel_agent(user_input: str, thread_id: str | None = None) -> dict:
    """Return a sample draft with the same response shape as the live graph."""
    thread_id = thread_id or f"demo_{uuid.uuid4().hex[:12]}"
    destination, route = _destination_for(user_input)
    selected = _selected_agents(user_input)
    constraints = {
        "destination": destination,
        "origin": "Dhaka (sample origin)",
        "duration": "5 days (sample duration)",
        "budget": "Flexible; confirm currency and total budget",
        "travel_style": "Balanced city exploration",
        "special_preferences": [],
    }

    draft = f"""## {destination}: a thoughtful 5-day draft

**Route:** {route}  
**Planning note:** This is a sample itinerary using illustrative guidance. Live availability and prices are not connected in demo mode.

### Day 1 · Arrive and settle in
Check in near a transit hub, keep the first afternoon flexible, and enjoy a relaxed neighborhood dinner.

### Day 2 · Discover the city
Start with a major cultural landmark, take a locally guided walk, and leave time for an unplanned café or market stop.

### Day 3 · A slower local day
Explore a second neighborhood, choose one museum or outdoor attraction, and keep the evening open for a regional meal.

### Day 4 · Signature day trip
Take a well-connected day trip or visit the city’s most distinctive district. Confirm opening days and transport before booking.

### Day 5 · One last stop and departure
Enjoy an easy breakfast, fit in one nearby highlight, and leave a generous transfer buffer for departure.

### Planning snapshot
- **Stay:** Compare well-reviewed central neighborhoods and check cancellation terms.
- **Getting around:** Use local transit for city days; reserve longer-distance transport ahead.
- **Budget:** Set daily limits for lodging, meals, transit, and activities before booking.
- **Before you go:** Verify entry requirements, opening hours, and current weather with official sources.

*Demo content only. No live search, booking, or price quote is being made.*"""

    _sessions[thread_id] = {"destination": destination, "draft": draft}
    return {
        "thread_id": thread_id,
        "answer": draft,
        "requires_approval": True,
        "approval_request": "Review this sample draft. Approve it, or ask for a revision using the feedback box.",
        "flight_results": "Sample route context only; live schedules and fares are not connected.",
        "hotel_results": "Sample accommodation guidance only; no properties or availability were searched.",
        "weather_results": "Sample seasonal-planning reminder; no current forecast was fetched.",
        "budget_results": "Sample budget framework; no live prices were retrieved.",
        "itinerary": draft,
        "selected_agents": selected,
        "trip_constraints": constraints,
        "supervisor_reasoning": "Demo supervisor selected specialists from the request topic. Responses are deterministic examples, not live agent calls.",
        "guardrail_allowed": True,
        "guardrail_reason": "Demo requests stay in the travel-planning experience.",
        "approved": None,
        "human_feedback": "",
        "llm_calls": 0,
    }


def resume_travel_agent(thread_id: str, approved: bool, feedback: str = "") -> dict:
    """Complete the demo review step without a model or external services."""
    session = _sessions.get(thread_id)
    if session is None:
        raise ValueError("This demo draft has expired. Generate a new sample plan.")

    destination = session["destination"]
    draft = session["draft"]
    review_note = (
        "Your draft was approved."
        if approved
        else f"Your revision request was recorded: {feedback.strip()}"
    )
    final = f"""## Your sample {destination} plan is ready

{review_note}

{draft}

### Next step
Use this as a planning outline, then confirm current prices, availability, travel documents, and local guidance before booking."""
    del _sessions[thread_id]
    return {
        "thread_id": thread_id,
        "answer": final,
        "requires_approval": False,
        "approval_request": "",
        "flight_results": "Sample only; no live flight search.",
        "hotel_results": "Sample only; no live hotel search.",
        "weather_results": "Sample only; no live weather lookup.",
        "budget_results": "Sample only; no live price data.",
        "itinerary": draft,
        "selected_agents": ["itinerary_agent"],
        "trip_constraints": {"destination": destination},
        "supervisor_reasoning": "Demo review complete.",
        "guardrail_allowed": True,
        "guardrail_reason": "",
        "approved": approved,
        "human_feedback": feedback.strip(),
        "llm_calls": 0,
    }
