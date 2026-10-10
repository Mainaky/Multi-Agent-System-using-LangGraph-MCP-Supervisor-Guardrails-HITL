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

  let map = null;
  let Route = null;
  let AdvancedMarkerElement = null;
  let LatLngBoundsClass = null;
  let origin = null;
  let destination = null;
  let originAutocomplete = null;
  let destinationAutocomplete = null;
  let routePolylines = [];
  let routeMarkers = [];

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
    }
    routeSummary.classList.add("hidden");
    clearMapError();
    updateRouteButton();
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
      }
      routeSummary.classList.add("hidden");
      updateRouteButton();
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
        fields: ["path", "distanceMeters", "durationMillis", "viewport"],
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
      const [{ Map }, { PlaceAutocompleteElement }, routesLibrary, markerLibrary, coreLibrary] = await Promise.all([
        google.maps.importLibrary("maps"),
        google.maps.importLibrary("places"),
        google.maps.importLibrary("routes"),
        google.maps.importLibrary("marker"),
        google.maps.importLibrary("core"),
      ]);
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
      originAutocomplete = addAutocompleteWidget(PlaceAutocompleteElement, originSlot, "origin", "Search for a city, address, or landmark");
      destinationAutocomplete = addAutocompleteWidget(PlaceAutocompleteElement, destinationSlot, "destination", "Where would you like to go?");
      map.addListener("click", (event) => {
        if (!event.latLng) return;
        const location = event.latLng.toJSON();
        const label = `Pinned location (${location.lat.toFixed(5)}, ${location.lng.toFixed(5)})`;
        if (destinationAutocomplete) destinationAutocomplete.value = "";
        setSelectedPlace("destination", { location, label, query: `${location.lat},${location.lng}` });
      });
    } catch (error) {
      mapState.innerHTML = "<span class=\"map-state-icon\">⌖</span><strong>Map connection unavailable</strong><span>Check the Maps key, enabled APIs, and allowed website referrers.</span>";
      setMapError(error.message || "Google Maps failed to initialize.");
      routeButton.disabled = true;
      document.getElementById("useLocationBtn").disabled = true;
    }
  }

  document.getElementById("routeBtn").addEventListener("click", showRoute);
  document.getElementById("useLocationBtn").addEventListener("click", useCurrentLocation);
  document.getElementById("travelMode").addEventListener("change", () => {
    if (origin && destination) showRoute();
  });

  if (apiKey) initializeMap();
  else showSetupInstructions();
})();
