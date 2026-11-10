(function () {
  const section = document.getElementById("mapPlanner");
  if (!section) return;

  const originInput = document.getElementById("originQuery");
  const destinationInput = document.getElementById("destinationQuery");
  const originSuggestions = document.getElementById("originSuggestions");
  const destinationSuggestions = document.getElementById("destinationSuggestions");
  const originSelected = document.getElementById("originSelected");
  const destinationSelected = document.getElementById("destinationSelected");
  const routeButton = document.getElementById("routeBtn");
  const mapState = document.getElementById("mapState");
  const mapError = document.getElementById("mapError");
  const routeSummary = document.getElementById("routeSummary");
  const nearbySearchButton = document.getElementById("nearbySearchButton");
  const nearbyResults = document.getElementById("nearbyResults");
  const nearbyEmpty = document.getElementById("nearbyEmpty");
  const nearbyLoading = document.getElementById("nearbyLoading");
  const nearbyDescription = document.getElementById("nearbyDescription");
  const nearbyRadius = document.getElementById("nearbyRadius");
  const mapHost = document.getElementById("mapCanvas");

  const endpoints = {
    geocode: "https://photon.komoot.io/api/",
    overpass: "https://overpass-api.de/api/interpreter",
    route: "https://router.project-osrm.org/route/v1/driving/",
  };
  const geocodeCache = new Map();
  const nearbyCache = new Map();
  let map = null;
  let routeLine = null;
  let destinationMarker = null;
  let routeMarkers = [];
  let nearbyMarkers = [];
  let origin = null;
  let destination = null;
  let activeNearbyKind = "hotels";
  let lastOverpassRequest = 0;

  function setMapError(message) {
    mapError.textContent = message;
    mapError.classList.remove("hidden");
  }

  function clearMapError() {
    mapError.textContent = "";
    mapError.classList.add("hidden");
  }

  function updateButtons() {
    routeButton.disabled = !(map && origin && destination);
    nearbySearchButton.disabled = !(map && destination);
  }

  function setPlaceLabel(node, label) {
    node.textContent = label;
    node.classList.toggle("has-place", Boolean(label));
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }

  function formatDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (!hours) return `${minutes} min`;
    return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
  }

  function metersBetween(first, second) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const lat1 = radians(first.lat);
    const lat2 = radians(second.lat);
    const deltaLat = radians(second.lat - first.lat);
    const deltaLng = radians(second.lng - first.lng);
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function makePopup(content) {
    const node = document.createElement("div");
    node.textContent = content;
    return node;
  }

  function makeMarkerIcon(kind) {
    const glyph = kind === "stations" ? "R" : kind === "airports" ? "✈" : kind === "start" ? "●" : "⌂";
    return L.divIcon({
      className: `nearby-icon nearby-icon-${kind}`,
      html: `<span><i>${glyph}</i></span>`,
      iconSize: [30, 36],
      iconAnchor: [15, 34],
    });
  }

  function clearNearby() {
    nearbyMarkers.forEach((marker) => marker.remove());
    nearbyMarkers = [];
    nearbyResults.replaceChildren();
    nearbyEmpty.classList.remove("hidden");
  }

  function clearRoute() {
    if (routeLine) routeLine.remove();
    routeLine = null;
    routeMarkers.forEach((marker) => marker.remove());
    routeMarkers = [];
  }

  function setSelectedPlace(kind, place) {
    if (kind === "origin") {
      origin = place;
      setPlaceLabel(originSelected, place.label);
    } else {
      destination = place;
      setPlaceLabel(destinationSelected, place.label);
      nearbyDescription.textContent = `Search OpenStreetMap listings near ${place.label}.`;
      nearbyEmpty.querySelector("strong").textContent = "Explore what’s nearby";
      nearbyEmpty.querySelector("span:last-child").textContent = "Choose a category and search to find mapped places around this destination.";
      clearNearby();
      if (map) {
        map.setView([place.lat, place.lng], 13);
        if (destinationMarker) destinationMarker.remove();
        destinationMarker = L.marker([place.lat, place.lng], { icon: makeMarkerIcon("destination"), title: place.label })
          .addTo(map).bindPopup(makePopup(`Destination: ${place.label}`));
      }
    }
    clearRoute();
    routeSummary.classList.add("hidden");
    clearMapError();
    updateButtons();
  }

  function labelForFeature(feature) {
    const p = feature.properties || {};
    return [p.name, p.city || p.district || p.county, p.state, p.country]
      .filter((part, index, all) => part && all.indexOf(part) === index)
      .join(", ") || "Unnamed place";
  }

  async function searchLocations(kind, input, list) {
    const query = input.value.trim();
    if (query.length < 2) {
      setMapError("Enter at least two characters to search for a place.");
      return;
    }
    clearMapError();
    const button = input.form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "…";
    list.replaceChildren();
    list.classList.remove("hidden");
    try {
      const cacheKey = query.toLowerCase();
      let features = geocodeCache.get(cacheKey);
      if (!features) {
        const url = new URL(endpoints.geocode);
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "5");
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("The place search service is temporarily unavailable. Try again shortly.");
        const data = await response.json();
        features = data.features || [];
        geocodeCache.set(cacheKey, features);
      }
      if (!features.length) {
        const empty = document.createElement("p");
        empty.className = "place-suggestion-empty";
        empty.textContent = "No results found. Try adding a city or country.";
        list.appendChild(empty);
        return;
      }
      features.forEach((feature) => {
        const [lng, lat] = feature.geometry?.coordinates || [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const option = document.createElement("button");
        option.type = "button";
        option.className = "place-suggestion-option";
        option.textContent = labelForFeature(feature);
        option.addEventListener("click", () => {
          const place = { lat, lng, label: labelForFeature(feature), query };
          input.value = place.label;
          list.classList.add("hidden");
          setSelectedPlace(kind, place);
          map.setView([lat, lng], 13);
        });
        list.appendChild(option);
      });
    } catch (error) {
      setMapError(error.message || "Place search failed. Try again.");
      list.classList.add("hidden");
    } finally {
      button.disabled = false;
      button.textContent = "⌕";
    }
  }

  function createNearbyCard(place, kind, distance) {
    const card = document.createElement("article");
    card.className = "nearby-card";
    const top = document.createElement("div");
    top.className = "nearby-card-top";
    const title = document.createElement("h4");
    title.textContent = place.name || (kind === "hotels" ? "Mapped accommodation" : "Mapped transport stop");
    top.appendChild(title);
    if (place.stars) {
      const rating = document.createElement("span");
      rating.className = "nearby-rating";
      rating.textContent = `${place.stars}★ OSM tag`;
      top.appendChild(rating);
    }
    card.appendChild(top);

    const addressText = [place.street, place.housenumber, place.city].filter(Boolean).join(" ") || place.operator || "Address not listed";
    const address = document.createElement("p");
    address.className = "nearby-address";
    address.textContent = addressText;
    card.appendChild(address);
    const distanceLine = document.createElement("p");
    distanceLine.className = "nearby-distance";
    distanceLine.textContent = `${formatDistance(distance)} straight-line distance`;
    card.appendChild(distanceLine);

    if (kind === "hotels") {
      const details = document.createElement("span");
      details.className = "nearby-price";
      details.textContent = place.rooms ? `${place.rooms} rooms tagged · no live rates` : "No live rates in OpenStreetMap";
      card.appendChild(details);
      const hint = document.createElement("p");
      hint.className = "nearby-summary";
      hint.textContent = "Room type, floor, current availability, and nightly price are not available from this map listing.";
      card.appendChild(hint);
    }

    const actions = document.createElement("div");
    actions.className = "nearby-actions";
    const osm = document.createElement("a");
    osm.href = `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=17/${place.lat}/${place.lng}`;
    osm.target = "_blank";
    osm.rel = "noopener noreferrer";
    osm.textContent = "OpenStreetMap";
    actions.appendChild(osm);
    const nameQuery = encodeURIComponent(place.name || "hotel");
    if (kind === "hotels") {
      const booking = document.createElement("a");
      booking.href = `https://www.google.com/travel/search?q=${nameQuery}%20${encodeURIComponent(addressText)}`;
      booking.target = "_blank";
      booking.rel = "noopener noreferrer";
      booking.textContent = "Check rates & rooms";
      actions.appendChild(booking);
      const website = place.website || place["contact:website"];
      if (website && /^https?:\/\//i.test(website)) {
        const link = document.createElement("a");
        link.href = website;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Property website";
        actions.appendChild(link);
      }
    }
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "nearby-pin-button";
    pin.textContent = "Show pin";
    pin.addEventListener("click", () => {
      map.setView([place.lat, place.lng], 16);
      const marker = nearbyMarkers.find((item) => item._tripmatePlace === place);
      if (marker) marker.openPopup();
    });
    actions.appendChild(pin);
    card.appendChild(actions);
    return card;
  }

  function nearbyQuery(kind, radius, lat, lng) {
    const selector = {
      hotels: '["tourism"~"^(hotel|hostel|guest_house|motel|apartment)$"]',
      stations: '["railway"~"^(station|halt)$"]',
      airports: '["aeroway"~"^(aerodrome|terminal)$"]',
    }[kind];
    return `[out:json][timeout:20];(nwr(around:${radius},${lat},${lng})${selector};);out center tags 60;`;
  }

  function placeFromOsm(element) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const tags = element.tags || {};
    return {
      lat,
      lng,
      name: tags.name || tags.brand || "Unnamed mapped place",
      street: tags["addr:street"],
      housenumber: tags["addr:housenumber"],
      city: tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
      operator: tags.operator,
      website: tags.website,
      "contact:website": tags["contact:website"],
      rooms: tags.rooms,
      stars: tags.stars,
    };
  }

  async function searchNearbyPlaces() {
    if (!destination || !map) return;
    clearMapError();
    nearbySearchButton.disabled = true;
    nearbySearchButton.textContent = "Searching…";
    nearbyLoading.classList.remove("hidden");
    nearbyEmpty.classList.add("hidden");
    nearbyResults.replaceChildren();
    nearbyMarkers.forEach((marker) => marker.remove());
    nearbyMarkers = [];
    const radius = Number(nearbyRadius.value);
    const key = `${activeNearbyKind}:${radius}:${destination.lat.toFixed(3)}:${destination.lng.toFixed(3)}`;
    try {
      let places = nearbyCache.get(key);
      if (!places) {
        const waitForRateLimit = Math.max(0, 1_100 - (Date.now() - lastOverpassRequest));
        if (waitForRateLimit) await new Promise((resolve) => window.setTimeout(resolve, waitForRateLimit));
        const query = nearbyQuery(activeNearbyKind, radius, destination.lat, destination.lng);
        const response = await fetch(endpoints.overpass, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
          body: new URLSearchParams({ data: query }),
        });
        lastOverpassRequest = Date.now();
        if (!response.ok) throw new Error("The community places service is busy. Please wait a little and try again.");
        const data = await response.json();
        places = (data.elements || []).map(placeFromOsm).filter(Boolean);
        nearbyCache.set(key, places);
      }
      if (!places.length) {
        nearbyEmpty.querySelector("strong").textContent = "No mapped places found in this radius";
        nearbyEmpty.querySelector("span:last-child").textContent = "Try a wider radius or another destination. OpenStreetMap coverage varies by area.";
        nearbyEmpty.classList.remove("hidden");
        return;
      }
      const bounds = L.latLngBounds([[destination.lat, destination.lng]]);
      places.forEach((place) => {
        const marker = L.marker([place.lat, place.lng], { icon: makeMarkerIcon(activeNearbyKind), title: place.name })
          .addTo(map).bindPopup(makePopup(place.name));
        marker._tripmatePlace = place;
        nearbyMarkers.push(marker);
        bounds.extend([place.lat, place.lng]);
        nearbyResults.appendChild(createNearbyCard(place, activeNearbyKind, metersBetween(destination, place)));
      });
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    } catch (error) {
      setMapError(error.message || "Nearby search failed. The free community service may be busy; try again later.");
      nearbyEmpty.querySelector("strong").textContent = "Nearby search is temporarily unavailable";
      nearbyEmpty.querySelector("span:last-child").textContent = "Try again in a moment. These community endpoints have no uptime guarantee.";
      nearbyEmpty.classList.remove("hidden");
    } finally {
      nearbyLoading.classList.add("hidden");
      nearbySearchButton.textContent = "Find nearby places";
      updateButtons();
    }
  }

  async function showRoute() {
    if (!origin || !destination || !map) return;
    clearMapError();
    routeButton.disabled = true;
    routeButton.textContent = "Mapping your route…";
    routeSummary.classList.add("hidden");
    clearRoute();
    if (destinationMarker) {
      destinationMarker.remove();
      destinationMarker = null;
    }
    try {
      const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const url = `${endpoints.route}${coordinates}?overview=full&geometries=geojson&steps=false`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("The public routing service is busy. Please try again shortly.");
      const data = await response.json();
      const route = data.routes?.[0];
      if (data.code !== "Ok" || !route) throw new Error("No driving route found. Choose places closer to roads or try different locations.");
      const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      routeLine = L.polyline(points, { color: "#176b52", weight: 6, opacity: 0.92 }).addTo(map);
      routeMarkers = [
        L.marker([origin.lat, origin.lng], { icon: makeMarkerIcon("start"), title: `Start: ${origin.label}` }).addTo(map).bindPopup(makePopup(`Start: ${origin.label}`)),
        L.marker([destination.lat, destination.lng], { icon: makeMarkerIcon("destination"), title: `Destination: ${destination.label}` }).addTo(map).bindPopup(makePopup(`Destination: ${destination.label}`)),
      ];
      map.fitBounds(routeLine.getBounds(), { padding: [40, 40], maxZoom: 14 });
      document.getElementById("routeDistance").textContent = formatDistance(route.distance);
      document.getElementById("routeDuration").textContent = formatDuration(route.duration);
      const directions = new URL("https://www.openstreetmap.org/directions");
      directions.searchParams.set("engine", "fossgis_osrm_car");
      directions.searchParams.set("route", `${origin.lat},${origin.lng};${destination.lat},${destination.lng}`);
      document.getElementById("openDirections").href = directions.toString();
      routeSummary.classList.remove("hidden");
      mapState.classList.add("hidden");
    } catch (error) {
      setMapError(error.message || "Could not calculate that route. Please try again.");
    } finally {
      routeButton.innerHTML = 'Show my route <span aria-hidden="true">↗</span>';
      updateButtons();
    }
  }

  function useCurrentLocation() {
    clearMapError();
    if (!navigator.geolocation) {
      setMapError("This browser does not support location sharing. Search for your starting point instead.");
      return;
    }
    const button = document.getElementById("useLocationBtn");
    button.disabled = true;
    button.textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const place = { lat: position.coords.latitude, lng: position.coords.longitude, label: `Current location (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`, query: "Current location" };
        originInput.value = place.label;
        setSelectedPlace("origin", place);
        map.setView([place.lat, place.lng], 13);
        button.disabled = false;
        button.innerHTML = '<span aria-hidden="true">◎</span> Use my current location';
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Location access was declined. Search for your starting point instead."
          : "Could not read your location. Search for your starting point instead.";
        setMapError(message);
        button.disabled = false;
        button.innerHTML = '<span aria-hidden="true">◎</span> Use my current location';
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    );
  }

  function initializeMap() {
    if (!window.L) {
      mapState.innerHTML = "<span class=\"map-state-icon\">⌖</span><strong>Map library could not load</strong><span>Refresh the page or check that the map library CDN is reachable.</span>";
      setMapError("Leaflet could not be loaded. Check your network connection and refresh the page.");
      return;
    }
    map = L.map(mapHost, { scrollWheelZoom: false }).setView([23.8103, 90.4125], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(map);
    map.whenReady(() => {
      mapState.classList.add("hidden");
      document.getElementById("useLocationBtn").disabled = false;
      updateButtons();
    });
    map.on("click", (event) => {
      const place = { lat: event.latlng.lat, lng: event.latlng.lng, label: `Pinned location (${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)})`, query: `${event.latlng.lat},${event.latlng.lng}` };
      destinationInput.value = place.label;
      destinationSuggestions.classList.add("hidden");
      setSelectedPlace("destination", place);
    });
    setTimeout(() => map.invalidateSize(), 0);
  }

  document.querySelectorAll(".place-search-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const kind = form.dataset.searchKind;
      searchLocations(kind, kind === "origin" ? originInput : destinationInput, kind === "origin" ? originSuggestions : destinationSuggestions);
    });
  });
  [originInput, destinationInput].forEach((input) => {
    input.addEventListener("input", () => {
      const kind = input === originInput ? "origin" : "destination";
      const selected = kind === "origin" ? origin : destination;
      if (!selected) return;
      if (kind === "origin") {
        origin = null;
        setPlaceLabel(originSelected, "Select a starting point");
      } else {
        destination = null;
        setPlaceLabel(destinationSelected, "Select a destination");
        nearbyDescription.textContent = "Choose a destination to discover nearby hotels, railway stations, and airports.";
        nearbyEmpty.querySelector("strong").textContent = "Explore what’s nearby";
        nearbyEmpty.querySelector("span:last-child").textContent = "Search for a destination, then choose a result to find mapped places around it.";
        clearNearby();
      }
      clearRoute();
      routeSummary.classList.add("hidden");
      updateButtons();
    });
  });
  routeButton.addEventListener("click", showRoute);
  document.getElementById("useLocationBtn").addEventListener("click", useCurrentLocation);
  nearbySearchButton.addEventListener("click", searchNearbyPlaces);
  document.querySelectorAll("[data-nearby-kind]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeNearbyKind = tab.dataset.nearbyKind;
      document.querySelectorAll("[data-nearby-kind]").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      if (destination) searchNearbyPlaces();
    });
  });
  nearbyRadius.addEventListener("change", () => {
    if (destination && nearbyResults.childElementCount) searchNearbyPlaces();
  });

  initializeMap();
})();
