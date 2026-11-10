(function () {
  const section = document.getElementById("mapPlanner");
  if (!section) return;

  const apiKey = document.body.dataset.googleMapsKey || "";
  const originSlot = document.getElementById("originAutocomplete");
  const destinationSlot = document.getElementById("destinationAutocomplete");
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

  let map = null;
  let Route = null;
  let AdvancedMarkerElement = null;
  let LatLngBoundsClass = null;
  let Place = null;
  let InfoWindow = null;
  let origin = null;
  let destination = null;
  let originAutocomplete = null;
  let destinationAutocomplete = null;
  let routePolylines = [];
  let routeMarkers = [];
  let nearbyMarkers = [];
  let activeInfoWindow = null;
  let activeNearbyKind = "hotels";

  function setMapError(message) {
    mapError.textContent = message;
    mapError.classList.remove("hidden");
  }

  function clearMapError() {
    mapError.textContent = "";
    mapError.classList.add("hidden");
  }

  function updateRouteButton() {
    routeButton.disabled = !(map && origin && destination);
  }

  function updateNearbyButton() {
    nearbySearchButton.disabled = !(map && Place && destination);
  }

  function clearNearbyMarkers() {
    nearbyMarkers.forEach((marker) => { marker.map = null; });
    nearbyMarkers = [];
    if (activeInfoWindow) activeInfoWindow.close();
  }

  function setPlaceLabel(node, label) {
    node.textContent = label;
    node.classList.toggle("has-place", Boolean(label));
  }

  function setSelectedPlace(kind, place) {
    if (kind === "origin") {
      origin = place;
      setPlaceLabel(originSelected, place.label);
    } else {
      destination = place;
      setPlaceLabel(destinationSelected, place.label);
      nearbyDescription.textContent = `Search for stays and transport links near ${place.label}.`;
      nearbyResults.replaceChildren();
      nearbyEmpty.classList.remove("hidden");
      nearbyEmpty.querySelector("strong").textContent = "Explore what’s nearby";
      nearbyEmpty.querySelector("span:last-child").textContent = "Choose a category and search to see real Google Maps places around this destination.";
      clearNearbyMarkers();
    }
    routeSummary.classList.add("hidden");
    clearMapError();
    updateRouteButton();
    updateNearbyButton();
  }

  function locationLiteral(location) {
    return typeof location.toJSON === "function"
      ? location.toJSON()
      : { lat: location.lat(), lng: location.lng() };
  }

  function addAutocompleteWidget(PlaceAutocompleteElement, slot, kind, placeholder) {
    const widget = new PlaceAutocompleteElement();
    widget.placeholder = placeholder;
    widget.setAttribute("aria-label", kind === "origin" ? "Starting point" : "Destination");
    widget.classList.add("tripmate-autocomplete");
    slot.replaceChildren(widget);

    widget.addEventListener("input", () => {
      if (kind === "origin" && origin) {
        origin = null;
        setPlaceLabel(originSelected, "Choose a new starting point");
      } else if (kind === "destination" && destination) {
        destination = null;
        setPlaceLabel(destinationSelected, "Choose a new destination");
        nearbyResults.replaceChildren();
        nearbyEmpty.classList.remove("hidden");
        nearbyDescription.textContent = "Choose a destination to discover nearby hotels, railway stations, and airports.";
        clearNearbyMarkers();
      }
      routeSummary.classList.add("hidden");
      updateRouteButton();
      updateNearbyButton();
    });

    widget.addEventListener("gmp-select", async (event) => {
      try {
        clearMapError();
        const place = event.placePrediction.toPlace();
        await place.fetchFields({ fields: ["displayName", "formattedAddress", "location", "viewport"] });
        if (!place.location) throw new Error("Google Maps could not find coordinates for that place.");
        const label = place.formattedAddress || place.displayName || "Selected place";
        setSelectedPlace(kind, { location: locationLiteral(place.location), label, query: place.formattedAddress || label });
        if (place.viewport) map.fitBounds(place.viewport);
        else map.panTo(place.location);
      } catch (error) {
        setMapError(error.message || "Could not load that place. Please select a result from the list.");
      }
    });
    return widget;
  }

  function loadMapsScript() {
    if (window.google && window.google.maps && window.google.maps.importLibrary) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Google Maps could not be loaded. Check the API key and enabled APIs."));
      document.head.appendChild(script);
    });
  }

  function showSetupInstructions() {
    const notice = document.getElementById("mapSetupNotice");
    notice.innerHTML = "<strong>Google Maps needs a key to go live.</strong> Add <code>GOOGLE_MAPS_API_KEY</code> to the Render service environment, with Maps JavaScript API, Places API (New), and Routes API enabled. Restrict the browser key to your demo domain.";
    notice.classList.remove("hidden");
    mapState.innerHTML = "<span class=\"map-state-icon\">⌖</span><strong>Google Maps is ready to connect</strong><span>Add the restricted Maps API key to activate place search, route pins, and live distance estimates.</span>";
    routeButton.disabled = true;
    document.getElementById("useLocationBtn").disabled = true;
  }

  function makePin(label, kind) {
    const pin = document.createElement("span");
    pin.className = `map-pin ${kind}-pin`;
    pin.setAttribute("aria-hidden", "true");
    const marker = new AdvancedMarkerElement({
      map,
      position: label.location,
      title: `${kind === "start" ? "Start" : "Destination"}: ${label.label}`,
      content: pin,
    });
    return marker;
  }

  function clearRouteOverlays() {
    routePolylines.forEach((polyline) => polyline.setMap(null));
    routeMarkers.forEach((marker) => { marker.map = null; });
    routePolylines = [];
    routeMarkers = [];
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }

  function formatDuration(milliseconds) {
    const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} min`;
    return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
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

  function formatMoneyRange(range) {
    if (!range?.startPrice) return "";
    const low = range.startPrice.toString();
    const high = range.endPrice?.toString();
    return high ? `${low}–${high}` : `${low}+`;
  }

  function safeLink(url, label, className = "") {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return null;
      const link = document.createElement("a");
      link.href = parsed.toString();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label;
      if (className) link.className = className;
      return link;
    } catch (_) {
      return null;
    }
  }

  function createNearbyCard(place, marker, kind, distanceMeters) {
    const card = document.createElement("article");
    card.className = "nearby-card";

    const top = document.createElement("div");
    top.className = "nearby-card-top";
    const title = document.createElement("h4");
    title.textContent = place.displayName || (kind === "hotels" ? "Nearby hotel" : "Nearby transport stop");
    top.appendChild(title);
    if (Number.isFinite(place.rating)) {
      const rating = document.createElement("span");
      rating.className = "nearby-rating";
      rating.textContent = `★ ${place.rating.toFixed(1)}${Number.isFinite(place.userRatingCount) ? ` · ${place.userRatingCount.toLocaleString()}` : ""}`;
      top.appendChild(rating);
    }
    card.appendChild(top);

    if (place.formattedAddress) {
      const address = document.createElement("p");
      address.className = "nearby-address";
      address.textContent = place.formattedAddress;
      card.appendChild(address);
    }
    const distance = document.createElement("p");
    distance.className = "nearby-distance";
    distance.textContent = `${formatDistance(distanceMeters)} as the crow flies`;
    card.appendChild(distance);

    if (kind === "hotels") {
      const priceRange = formatMoneyRange(place.priceRange);
      const priceText = priceRange
        ? `Google general price range ${priceRange} · not a date-based quote`
        : (place.priceLevel ? `General Google price level: ${String(place.priceLevel).replaceAll("_", " ").replace("PRICE LEVEL ", "").toLowerCase()} · no dated nightly rate` : "No public price information listed");
      const price = document.createElement("span");
      price.className = "nearby-price";
      price.textContent = priceText;
      card.appendChild(price);
      const hint = document.createElement("p");
      hint.className = "nearby-summary";
      hint.textContent = place.editorialSummary || "Room types, floor, cancellation terms, and dated rates are not included in Google Maps place data.";
      card.appendChild(hint);
    }

    const actions = document.createElement("div");
    actions.className = "nearby-actions";
    const mapsLink = safeLink(place.googleMapsURI, "View on Google Maps");
    if (mapsLink) actions.appendChild(mapsLink);
    if (kind === "hotels") {
      const hotelSearch = new URL("https://www.google.com/travel/search");
      hotelSearch.searchParams.set("q", `${place.displayName || "hotel"} ${place.formattedAddress || destination.label}`);
      const roomsLink = safeLink(hotelSearch.toString(), "Check dates & rooms");
      if (roomsLink) actions.appendChild(roomsLink);
      const website = safeLink(place.websiteURI, "Property website");
      if (website) actions.appendChild(website);
    } else {
      const directions = new URL("https://www.google.com/maps/dir/");
      directions.searchParams.set("api", "1");
      directions.searchParams.set("origin", destination.query || destination.label);
      directions.searchParams.set("destination", place.displayName || place.formattedAddress || "");
      directions.searchParams.set("travelmode", kind === "stations" ? "transit" : "driving");
      const directionsLink = safeLink(directions.toString(), kind === "stations" ? "Transit directions" : "Driving directions");
      if (directionsLink) actions.appendChild(directionsLink);
    }
    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "nearby-pin-button";
    pinButton.textContent = "Show pin";
    pinButton.addEventListener("click", () => {
      map.panTo(place.location);
      map.setZoom(15);
      if (marker && activeInfoWindow) {
        activeInfoWindow.setContent(document.createTextNode(place.displayName || "Selected place"));
        activeInfoWindow.open({ map, anchor: marker });
      }
    });
    actions.appendChild(pinButton);
    card.appendChild(actions);
    return card;
  }

  async function searchNearbyPlaces() {
    if (!destination || !Place || !map) return;
    clearMapError();
    nearbySearchButton.disabled = true;
    nearbySearchButton.textContent = "Searching…";
    nearbyLoading.classList.remove("hidden");
    nearbyEmpty.classList.add("hidden");
    nearbyResults.replaceChildren();
    clearNearbyMarkers();
    const category = {
      hotels: { types: ["lodging"], icon: "⌂" },
      stations: { types: ["train_station", "transit_station"], icon: "R" },
      airports: { types: ["airport"], icon: "✈" },
    }[activeNearbyKind];
    try {
      const { places = [] } = await Place.searchNearby({
        fields: ["displayName", "location", "formattedAddress", "googleMapsURI", "rating", "userRatingCount", "priceLevel", "priceRange", "websiteURI"],
        locationRestriction: {
          center: destination.location,
          radius: Number(nearbyRadius.value),
        },
        includedTypes: category.types,
        maxResultCount: 8,
        rankPreference: "DISTANCE",
      });
      if (!places.length) {
        nearbyEmpty.querySelector("strong").textContent = "No matching places found nearby";
        nearbyEmpty.querySelector("span:last-child").textContent = "Try a larger search radius or another destination.";
        nearbyEmpty.classList.remove("hidden");
        return;
      }

      places.forEach((place) => {
        if (!place.location) return;
        const distance = metersBetween(destination.location, locationLiteral(place.location));
        const markerContent = document.createElement("span");
        markerContent.className = `nearby-map-pin ${activeNearbyKind === "stations" ? "station" : activeNearbyKind === "airports" ? "airport" : ""}`;
        markerContent.textContent = category.icon;
        const marker = new AdvancedMarkerElement({
          map,
          position: place.location,
          title: place.displayName || "Nearby place",
          content: markerContent,
          gmpClickable: true,
        });
        marker.addListener("click", () => {
          if (!activeInfoWindow) return;
          activeInfoWindow.setContent(document.createTextNode(place.displayName || "Nearby place"));
          activeInfoWindow.open({ map, anchor: marker });
        });
        nearbyMarkers.push(marker);
        nearbyResults.appendChild(createNearbyCard(place, marker, activeNearbyKind, distance));
      });
      if (!nearbyResults.childElementCount) throw new Error("Google returned places without map coordinates. Try another search area.");
      const locations = [destination.location, ...places.filter((place) => place.location).map((place) => place.location)];
      const bounds = new LatLngBoundsClass();
      locations.forEach((location) => bounds.extend(location));
      map.fitBounds(bounds, 70);
    } catch (error) {
      setMapError(error.message || "Google Maps could not search nearby places. Check Places API access and billing.");
      nearbyEmpty.querySelector("strong").textContent = "Nearby search could not be completed";
      nearbyEmpty.querySelector("span:last-child").textContent = "Check that Places API (New) is enabled for the restricted Maps key, then try again.";
      nearbyEmpty.classList.remove("hidden");
    } finally {
      nearbyLoading.classList.add("hidden");
      nearbySearchButton.textContent = "Find nearby places";
      updateNearbyButton();
    }
  }

  async function showRoute() {
    if (!origin || !destination || !Route) return;
    clearMapError();
    routeButton.disabled = true;
    routeButton.textContent = "Mapping your route…";
    routeSummary.classList.add("hidden");
    try {
      clearRouteOverlays();
      const { routes } = await Route.computeRoutes({
        origin: origin.location,
        destination: destination.location,
        travelMode: document.getElementById("travelMode").value,
        fields: ["path", "distanceMeters", "durationMillis", "viewport", "travelAdvisory"],
      });
      if (!routes || !routes.length) throw new Error("No route was found between those places. Try another travel mode.");

      const route = routes[0];
      if (!Number.isFinite(route.distanceMeters) || !Number.isFinite(route.durationMillis)) {
        throw new Error("Google Maps returned a route without distance and time details. Please try a different destination or travel mode.");
      }
      routePolylines = route.createPolylines();
      routePolylines.forEach((polyline) => {
        polyline.setOptions({ strokeColor: "#176b52", strokeOpacity: 0.92, strokeWeight: 6 });
        polyline.setMap(map);
      });
      routeMarkers = [makePin(origin, "start"), makePin(destination, "end")];
      if (route.viewport) map.fitBounds(route.viewport, 64);
      else if (route.path?.length) {
        const bounds = new LatLngBoundsClass();
        route.path.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, 64);
      }

      document.getElementById("routeDistance").textContent = formatDistance(route.distanceMeters);
      document.getElementById("routeDuration").textContent = formatDuration(route.durationMillis);
      const fare = route.travelAdvisory?.transitFare;
      const fareMetric = document.getElementById("routeFareMetric");
      if (document.getElementById("travelMode").value === "TRANSIT" && fare) {
        document.getElementById("routeFare").textContent = typeof fare === "string" ? fare : fare.toString();
        fareMetric.classList.remove("hidden");
      } else {
        fareMetric.classList.add("hidden");
      }
      const directions = new URL("https://www.google.com/maps/dir/");
      directions.searchParams.set("api", "1");
      directions.searchParams.set("origin", origin.query || origin.label);
      directions.searchParams.set("destination", destination.query || destination.label);
      directions.searchParams.set("travelmode", document.getElementById("travelMode").value.toLowerCase());
      document.getElementById("openDirections").href = directions.toString();
      routeSummary.classList.remove("hidden");
      mapState.classList.add("hidden");
    } catch (error) {
      setMapError(error.message || "Could not calculate that route. Please try again.");
    } finally {
      routeButton.innerHTML = 'Show my route <span aria-hidden="true">↗</span>';
      updateRouteButton();
    }
  }

  async function useCurrentLocation() {
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
        const location = { lat: position.coords.latitude, lng: position.coords.longitude };
        const label = `Current location (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
        if (originAutocomplete) originAutocomplete.value = "";
        setSelectedPlace("origin", { location, label, query: `${location.lat},${location.lng}` });
        map.panTo(location);
        map.setZoom(13);
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

  async function initializeMap() {
    try {
      await loadMapsScript();
      const [{ Map, InfoWindow: InfoWindowClass }, placesLibrary, routesLibrary, markerLibrary, coreLibrary] = await Promise.all([
        google.maps.importLibrary("maps"),
        google.maps.importLibrary("places"),
        google.maps.importLibrary("routes"),
        google.maps.importLibrary("marker"),
        google.maps.importLibrary("core"),
      ]);
      const { PlaceAutocompleteElement: PlaceAutocompleteClass, Place: PlaceClass } = placesLibrary;
      Place = PlaceClass;
      InfoWindow = InfoWindowClass;
      activeInfoWindow = new InfoWindow();
      Route = routesLibrary.Route;
      AdvancedMarkerElement = markerLibrary.AdvancedMarkerElement;
      LatLngBoundsClass = coreLibrary.LatLngBounds;
      map = new Map(document.getElementById("googleMap"), {
        center: { lat: 20, lng: 0 },
        zoom: 2,
        mapId: "DEMO_MAP_ID",
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: true,
      });
      mapState.classList.add("hidden");
      document.getElementById("useLocationBtn").disabled = false;
      originAutocomplete = addAutocompleteWidget(PlaceAutocompleteClass, originSlot, "origin", "Search for a city, address, or landmark");
      destinationAutocomplete = addAutocompleteWidget(PlaceAutocompleteClass, destinationSlot, "destination", "Where would you like to go?");
      map.addListener("click", (event) => {
        if (!event.latLng) return;
        const location = event.latLng.toJSON();
        const label = `Pinned location (${location.lat.toFixed(5)}, ${location.lng.toFixed(5)})`;
        if (destinationAutocomplete) destinationAutocomplete.value = "";
        setSelectedPlace("destination", { location, label, query: `${location.lat},${location.lng}` });
      });
      updateNearbyButton();
    } catch (error) {
      mapState.innerHTML = "<span class=\"map-state-icon\">⌖</span><strong>Map connection unavailable</strong><span>Check the Maps key, enabled APIs, and allowed website referrers.</span>";
      setMapError(error.message || "Google Maps failed to initialize.");
      routeButton.disabled = true;
      document.getElementById("useLocationBtn").disabled = true;
      nearbySearchButton.disabled = true;
      document.querySelectorAll("[data-nearby-kind]").forEach((tab) => { tab.disabled = true; });
      nearbyRadius.disabled = true;
    }
  }

  document.getElementById("routeBtn").addEventListener("click", showRoute);
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
      if (destination && Place) searchNearbyPlaces();
    });
  });
  nearbyRadius.addEventListener("change", () => {
    if (destination && Place && nearbyResults.childElementCount) searchNearbyPlaces();
  });
  document.getElementById("travelMode").addEventListener("change", () => {
    if (origin && destination) showRoute();
  });

  if (apiKey) initializeMap();
  else {
    showSetupInstructions();
    nearbySearchButton.disabled = true;
    document.querySelectorAll("[data-nearby-kind]").forEach((tab) => { tab.disabled = true; });
    nearbyRadius.disabled = true;
  }
})();
