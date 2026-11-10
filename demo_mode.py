"""Credential-free itinerary drafts that tailor the demo to a user's trip."""

from __future__ import annotations

import re
import uuid


_sessions: dict[str, dict[str, str]] = {}

_DESTINATIONS = {
    "japan": ("Japan", "Tokyo", ["Asakusa and Senso-ji", "Meiji Shrine and Harajuku", "Kyoto's Higashiyama district", "Osaka's food streets"]),
    "tokyo": ("Tokyo", "Tokyo", ["Asakusa and Senso-ji", "Meiji Shrine and Harajuku", "Ueno museums and park", "Shibuya and a quieter backstreet café"]),
    "kyoto": ("Kyoto", "Kyoto", ["Higashiyama and Kiyomizu-dera", "Arashiyama riverside", "Nishiki Market and central lanes", "Fushimi Inari early in the day"]),
    "thailand": ("Thailand", "Bangkok", ["Old Bangkok temples", "A local food market", "A canal or riverside neighborhood", "A relaxed park or day trip"]),
    "bangkok": ("Bangkok", "Bangkok", ["Old Bangkok temples", "A local food market", "A canal or riverside neighborhood", "A relaxed park or day trip"]),
    "dubai": ("Dubai", "Dubai", ["Al Fahidi and Dubai Creek", "Downtown and the Dubai Mall area", "Jumeirah coastline", "Marina and a quieter beach stop"]),
    "italy": ("Italy", "Rome", ["The Colosseum and Roman Forum", "The historic center and Pantheon area", "Trastevere and the river", "A Florence or local neighborhood day"]),
    "rome": ("Rome", "Rome", ["The Colosseum and Roman Forum", "The historic center and Pantheon area", "Trastevere and the river", "Villa Borghese or a slower neighborhood day"]),
    "paris": ("Paris", "Paris", ["Île de la Cité and the river", "A museum chosen around your interests", "Montmartre and nearby streets", "A market, garden, or Versailles day"]),
    "france": ("France", "Paris", ["Île de la Cité and the river", "A museum chosen around your interests", "Montmartre and nearby streets", "A market, garden, or Versailles day"]),
    "singapore": ("Singapore", "Singapore", ["Marina Bay and the waterfront", "Chinatown and nearby heritage streets", "Gardens by the Bay", "A hawker center and a neighborhood walk"]),
    "delhi": ("Delhi", "Delhi", ["Old Delhi, Jama Masjid, and Chandni Chowk", "Humayun's Tomb and Lodhi Garden", "India Gate and the central avenue", "A museum or market matched to your interests"]),
    "kolkata": ("Kolkata", "Kolkata", ["Victoria Memorial and the Maidan", "College Street and a North Kolkata heritage walk", "Kumartuli and the riverfront", "A local food walk around a neighborhood market"]),
    "mumbai": ("Mumbai", "Mumbai", ["Fort, Kala Ghoda, and the Gateway area", "Marine Drive and a coastal walk", "A local market and heritage district", "A museum, ferry, or slower neighborhood day"]),
    "jaipur": ("Jaipur", "Jaipur", ["Amber Fort and the old city", "City Palace and Hawa Mahal area", "A local craft market", "A quieter stepwell or nearby day trip"]),
    "dhaka": ("Dhaka", "Dhaka", ["Old Dhaka heritage area", "A riverside or historic neighborhood", "A museum and local food stop", "A quieter green space and market"]),
    "goa": ("Goa", "Goa", ["A beach suited to your pace", "A Portuguese-era heritage area", "A local market and seafood stop", "A quieter coastal village"]),
    "london": ("London", "London", ["Westminster and the Thames", "A museum chosen around your interests", "A neighborhood market and walk", "A park or nearby day trip"]),
}

_INTERESTS = {
    "food": ("food", "Prioritize a market, local specialty, and one well-reviewed neighborhood restaurant each day."),
    "design": ("design", "Include architecture, design districts, and time to explore independent shops."),
    "art": ("art", "Choose one gallery or museum at a time and leave space for nearby studios or public art."),
    "history": ("history", "Prioritize historic districts, a guided walk, and context-rich museums."),
    "beach": ("coast", "Balance beach time with shade, water, and an easy transport connection."),
    "nature": ("nature", "Add a park or outdoor stop daily and keep a weather-friendly indoor alternative."),
    "shopping": ("shopping", "Group markets and shops by neighborhood to avoid unnecessary cross-city travel."),
    "quiet": ("a slower pace", "Keep mornings unhurried and leave a flexible afternoon most days."),
    "relaxed": ("a relaxed pace", "Plan one main activity each day and leave room for breaks."),
    "family": ("family-friendly stops", "Prefer short transfers, early starts, and activities with nearby rest breaks."),
    "adventure": ("outdoor activities", "Add an active outing while keeping a weather backup and safe return plan."),
}


def _extract_route(message: str) -> tuple[str, str] | None:
    """Read common 'from A to B' and 'A to B' prompts without guessing."""
    place = r"([\wÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ .’'\-]{0,70}?)"
    end = r"(?=\s+(?:for|over|with|during|leaving|starting|and)\b|[,;!?]|$)"
    match = re.search(rf"\bfrom\s+{place}\s+to\s+{place}{end}", message, re.IGNORECASE)
    if not match:
        direct = re.sub(r"^\s*(?:please\s+)?(?:plan(?:\s+me)?\s+(?:a\s+)?(?:trip\s+)?)", "", message, flags=re.IGNORECASE)
        match = re.match(rf"\s*{place}\s+to\s+{place}{end}", direct, re.IGNORECASE)
    if not match:
        return None
    origin, destination = (part.strip(" .,;:-") for part in match.groups())
    if not origin or not destination:
        return None
    return origin, destination


def _destination_for(message: str) -> str:
    route = _extract_route(message)
    if route:
        return route[1]
    lowered = message.casefold()
    for keyword in sorted(_DESTINATIONS, key=len, reverse=True):
        if re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", lowered):
            return _DESTINATIONS[keyword][0]
    match = re.search(
        r"\b(?:visit|in|around|to)\s+([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ.'’\-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ.'’\-]*){0,2})",
        message,
    )
    return match.group(1).strip() if match else "your selected destination"


def _duration_for(message: str) -> int:
    match = re.search(r"\b(\d{1,2})\s*[- ]?\s*(days?|nights?)\b", message, re.IGNORECASE)
    if match:
        return min(14, max(1, int(match.group(1))))
    match = re.search(r"\b(\d{1,2})\s*[- ]?\s*weeks?\b", message, re.IGNORECASE)
    if match:
        return min(14, max(2, int(match.group(1)) * 7))
    return 5


def _budget_for(message: str) -> str:
    match = re.search(
        r"\b(?:budget|under|below|around|about)\s*(?:of\s*)?([₹$€£]?\s?\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|INR|BDT|EUR|GBP|taka|rupees?)?)",
        message,
        re.IGNORECASE,
    )
    return match.group(1).strip() if match else "Not provided — confirm total budget and currency"


def _preferences_for(message: str) -> tuple[list[str], str]:
    lowered = message.casefold()
    matched = [(key, value) for key, value in _INTERESTS.items() if re.search(rf"(?<!\w){re.escape(key)}(?!\w)", lowered)]
    if not matched:
        return ["balanced sightseeing", "local food", "a flexible pace"], "Use a balanced mix of one major sight, local food, and unplanned time."
    return [value[0] for _, value in matched], " ".join(value[1] for _, value in matched)


def _ideas_for(destination: str) -> list[str]:
    lowered = destination.casefold()
    for key in sorted(_DESTINATIONS, key=len, reverse=True):
        if re.search(rf"(?<!\w){re.escape(key)}(?!\w)", lowered):
            return _DESTINATIONS[key][2]
    return [
        f"A central landmark or heritage site in {destination}",
        f"A locally known market and food district in {destination}",
        f"A park, waterfront, or outdoor area in {destination}",
        f"A museum or neighborhood walk in {destination}",
    ]


def _selected_agents(message: str) -> list[str]:
    lowered = message.casefold()
    selected = []
    if any(word in lowered for word in ("flight", "fly", "airfare", "airport", "train", "rail", "route", "from", " to ")):
        selected.append("flight_agent")
    if any(word in lowered for word in ("hotel", "stay", "accommodation", "hostel")):
        selected.append("hotel_agent")
    if any(word in lowered for word in ("weather", "season", "pack", "beach", "winter", "summer")):
        selected.append("weather_agent")
    if any(word in lowered for word in ("budget", "cost", "price", "under", "cheap", "affordable")):
        selected.append("budget_agent")
    selected.extend(agent for agent in ("hotel_agent", "weather_agent", "budget_agent") if agent not in selected)
    selected.append("itinerary_agent")
    return selected


def _build_draft(message: str, origin: str, destination: str, days: int, budget: str, interests: list[str], preference_note: str) -> str:
    ideas = _ideas_for(destination)
    day_titles = [
        "Arrive and settle in", "Explore a signature area", "Culture and local life",
        "A slower neighborhood day", "One last highlight and departure",
    ]
    daily = []
    for day in range(1, days + 1):
        if day == 1:
            activity = f"Travel from {origin} to {destination}. Keep the arrival evening light, check in near a useful transit connection, and eat close to your stay."
        elif day == days:
            activity = f"Choose one nearby stop such as {ideas[(day - 2) % len(ideas)]}, then leave a generous transfer buffer for your departure."
        else:
            idea = ideas[(day - 2) % len(ideas)]
            activity = f"Explore {idea}. Group nearby sights together, take a meal break in the same area, and keep the evening flexible."
        title = day_titles[min(day - 1, len(day_titles) - 1)]
        daily.append(f"### Day {day} · {title}\n{activity}")

    route_label = f"{origin} → {destination}" if origin != "Not specified" else destination
    preference_text = ", ".join(interests)
    return f"""## {route_label}: a tailored {days}-day planning draft

**Route:** {route_label}

**Trip style:** {preference_text}

**Budget target:** {budget}
**Demo note:** This draft uses your cities, duration, budget, and stated interests, but it is generated from a structured demo template—not a live AI model call. Attractions below are planning suggestions; verify current opening hours and access before booking.

{chr(10).join(daily)}

### Practical recommendations
- **Intercity transport:** Compare rail and air for your dates, baggage, arrival station/airport, and total door-to-door time. The map below draws a driving route only; it does not estimate rail or flight fares.
- **Stay:** Search around a central transit hub, check recent reviews and cancellation terms, and confirm room type, floor, and nightly rates with the property.
- **Daily pacing:** {preference_note}
- **Budget:** Keep separate limits for intercity transport, lodging, meals, local transport, and activities. The amount above is your requested target, not a verified quote.
- **Before departure:** Check the official weather forecast, entry requirements, attraction opening days, and current transport schedules.

*No booking, live hotel availability, flight/train timetable, or fare quote was retrieved in demo mode.*"""


def run_travel_agent(user_input: str, thread_id: str | None = None) -> dict:
    """Return a city-pair-aware sample plan with the same shape as the graph."""
    thread_id = thread_id or f"demo_{uuid.uuid4().hex[:12]}"
    route = _extract_route(user_input)
    origin, destination = route if route else ("Not specified", _destination_for(user_input))
    days = _duration_for(user_input)
    budget = _budget_for(user_input)
    interests, preference_note = _preferences_for(user_input)
    selected = _selected_agents(user_input)
    draft = _build_draft(user_input, origin, destination, days, budget, interests, preference_note)
    constraints = {
        "destination": destination,
        "origin": origin,
        "duration": f"{days} days",
        "budget": budget,
        "travel_style": ", ".join(interests),
        "special_preferences": interests,
    }
    _sessions[thread_id] = {"destination": destination, "origin": origin, "draft": draft}
    return {
        "thread_id": thread_id,
        "answer": draft,
        "requires_approval": True,
        "approval_request": "Review the tailored demo draft. Approve it, or request changes using the feedback box.",
        "flight_results": f"Demo guidance for {origin} to {destination}: compare rail and air for your travel dates; no live schedule or fare lookup was made.",
        "hotel_results": f"Demo guidance for {destination}: use the nearby Hotels map tab to look for mapped properties; room rates and availability are not live.",
        "weather_results": f"No live forecast was retrieved for {destination}. Check an official forecast for your exact travel dates.",
        "budget_results": f"Requested budget target: {budget}. No live costs were retrieved.",
        "itinerary": draft,
        "selected_agents": selected,
        "trip_constraints": constraints,
        "supervisor_reasoning": "Demo mode parsed the route and travel preferences to choose relevant sections. No LLM supervisor or external MCP agents were called.",
        "guardrail_allowed": True,
        "guardrail_reason": "Demo requests stay in the travel-planning experience.",
        "approved": None,
        "human_feedback": "",
        "llm_calls": 0,
    }


def resume_travel_agent(thread_id: str, approved: bool, feedback: str = "") -> dict:
    """Complete the demo review step without claiming a model generated it."""
    session = _sessions.get(thread_id)
    if session is None:
        raise ValueError("This demo draft has expired. Generate a new plan.")
    destination = session["destination"]
    draft = session["draft"]
    review_note = "Your draft was approved." if approved else f"Revision request noted: {feedback.strip()}"
    final = f"""## Your demo travel plan for {destination}

{review_note}

{draft}

### Final reminder
Verify current prices, availability, travel documents, opening times, and local guidance with the relevant providers before booking."""
    del _sessions[thread_id]
    return {
        "thread_id": thread_id,
        "answer": final,
        "requires_approval": False,
        "approval_request": "",
        "flight_results": "Demo only; no live flight search.",
        "hotel_results": "Demo only; use map listings to open public property details.",
        "weather_results": "Demo only; no live forecast lookup.",
        "budget_results": "Demo only; no live price data.",
        "itinerary": draft,
        "selected_agents": ["itinerary_agent"],
        "trip_constraints": {"origin": session["origin"], "destination": destination},
        "supervisor_reasoning": "Demo review complete; no LLM calls were made.",
        "guardrail_allowed": True,
        "guardrail_reason": "",
        "approved": approved,
        "human_feedback": feedback.strip(),
        "llm_calls": 0,
    }
