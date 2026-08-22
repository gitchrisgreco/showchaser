import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Music, MapPin, Calendar as CalendarIcon, Search, Heart, Share2,
  ArrowLeft, Bell, Home as HomeIcon, Map as MapIcon, List as ListIcon,
  Bookmark, User, Ticket, Navigation, Mountain, Sparkles, X, ChevronRight
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

/* ---------------------------------------------------------
   ShowChaser — road-trip live music discovery, prototype
   Palette: desert dusk. Deep pine header, terracotta accent,
   sun-bleached sand cards, dashed "trail" as the wayfinding motif.
--------------------------------------------------------- */

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap');`;

/* ---------------------------------------------------------
   Ticketmaster Discovery API — real data
   NOTE: this is a dev/prototype key pasted in chat. Rotate it
   in the Ticketmaster developer portal before any real launch.
   Scope note: Discovery API searches by city, not by route —
   so this pulls real shows near the origin and destination
   cities, not truly "along the route" yet. That needs a
   geocoding/routing API (e.g. Mapbox) layered on top later.
--------------------------------------------------------- */
const TICKETMASTER_API_KEY = "XxnONAEUBuv48hfFN7Xrl7oN5TelayBg";

/* JamBase Data API — free Developer tier (non-commercial, 1,000 calls/mo).
   NOTE: exact query param names weren't verifiable from JamBase's docs
   (JS-rendered, not scrapable) — this uses the most standard REST
   convention (city/stateCode), and still only queries the two endpoint
   cities (not route-sampled like Ticketmaster below) since we don't have
   confirmed geo-radius param names for JamBase yet. */
const JAMBASE_API_KEY = "jbd_trial_9gvrBZCl1T5t_xH4X0a5ADxImA4jIlrpj5Vogm7mxPVTf";

/* Mapbox — free tier, geocoding + driving directions.
   Used to turn "Boulder, CO" / "Chicago, IL" into real coordinates and a
   real driving route, so Ticketmaster search can sample points along the
   actual path instead of just the two endpoint cities. */
const MAPBOX_TOKEN = "pk.eyJ1IjoiY2hyaXNncmVjbzE0IiwiYSI6ImNtdDNkN3gwMzB1cjYyd3B3MjViMzdoNzAifQ.A1rG5SDaiZolTNVUsdmvdg";
mapboxgl.accessToken = MAPBOX_TOKEN;

async function geocodePlace(query, label) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=US&limit=1`;
  console.log(`[ShowChaser] Geocoding ${label} (${query}):`, url);
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    console.error(`[ShowChaser] Mapbox geocode network error (${label}):`, networkErr);
    throw new Error(`network-blocked:geocode-${label}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[ShowChaser] Mapbox geocode HTTP ${res.status} (${label}):`, body);
    throw new Error(`http-${res.status}:geocode-${label}`);
  }
  const json = await res.json();
  const feature = json?.features?.[0];
  if (!feature) throw new Error(`geocode-empty:${label}`);
  const [lon, lat] = feature.center;
  console.log(`[ShowChaser] Geocoded ${label} to:`, lat, lon);
  return { lat, lon };
}

async function getDrivingRoute(fromCoord, toCoord) {
  const coords = `${fromCoord.lon},${fromCoord.lat};${toCoord.lon},${toCoord.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
  console.log(`[ShowChaser] Fetching driving route:`, url);
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    console.error(`[ShowChaser] Mapbox directions network error:`, networkErr);
    throw new Error(`network-blocked:directions`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[ShowChaser] Mapbox directions HTTP ${res.status}:`, body);
    throw new Error(`http-${res.status}:directions`);
  }
  const json = await res.json();
  const route = json?.routes?.[0];
  if (!route) throw new Error("directions-empty");
  console.log(`[ShowChaser] Route found: ${(route.distance / 1609.34).toFixed(0)} miles, ${route.geometry.coordinates.length} points`);
  return route.geometry.coordinates; // array of [lon, lat]
}

function sampleRoutePoints(coordinates, numPoints) {
  if (coordinates.length <= numPoints) return coordinates.map(([lon, lat]) => ({ lat, lon }));
  const step = (coordinates.length - 1) / (numPoints - 1);
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const [lon, lat] = coordinates[Math.round(i * step)];
    points.push({ lat, lon });
  }
  return points;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchOneJamBase(loc, label) {
  const params = new URLSearchParams({ city: loc.city, stateCode: loc.stateCode });
  const url = `https://data.jambase.com/v3/events?${params.toString()}`;
  console.log(`[ShowChaser] Fetching JamBase ${label}:`, url);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${JAMBASE_API_KEY}` } });
  } catch (networkErr) {
    console.error(`[ShowChaser] JamBase network error (${label}) — likely blocked (CORS/sandbox):`, networkErr);
    throw new Error(`network-blocked:jambase-${label}`);
  }
  console.log(`[ShowChaser] JamBase ${label} response status:`, res.status);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[ShowChaser] JamBase ${label} HTTP ${res.status} — check param names against Request Builder:`, body);
    throw new Error(`http-${res.status}:jambase-${label}`);
  }
  return res.json();
}

/* Real deep links for the "Nearby" CTAs, built from the venue's city — we
   don't have a places/lodging API wired in, so these point at each
   platform's own public search rather than specific named properties.
   Hotels.com's search.do URL is a long-standing public pattern but,
   like JamBase, hasn't been click-tested end to end — verify before launch.
   Harvest Hosts' /discover map is confirmed public (no login required). */
function buildNearbyLinks(city) {
  if (!city) return [];
  return [
    {
      label: `Hotels near ${city}`,
      type: "lodge",
      platform: "Hotels.com",
      url: `https://www.hotels.com/search.do?destination=${encodeURIComponent(city)}`,
    },
    {
      label: `Harvest Hosts near ${city}`,
      type: "harvest",
      platform: "Harvest Hosts",
      url: "https://www.harvesthosts.com/discover",
    },
  ];
}

function transformJamBaseEvent(event) {
  const venue = event.venue || {};
  return {
    id: `jb-${event.identifier || event.id}`,
    name: event.performer?.[0]?.name || event.name || "Live Music",
    venue: venue.name || "Venue TBA",
    city: venue.city && venue.stateCode ? `${venue.city}, ${venue.stateCode}` : "",
    date: formatEventDate(event.startDate?.split?.("T")?.[0]),
    time: formatEventTime(event.startDate?.split?.("T")?.[1]?.slice(0, 5)),
    ages: "Check venue",
    genres: ["Live Music"],
    match: null,
    detour: null,
    price: "See site",
    source: "JamBase",
    ticketUrl: event.url || event.offers?.[0]?.url,
    why: ["Found near your trip cities via JamBase", "Tickets available"],
    nearby: buildNearbyLinks(venue.city && venue.stateCode ? `${venue.city}, ${venue.stateCode}` : ""),
  };
}

function formatEventDate(localDate) {
  if (!localDate) return "Date TBA";
  const d = new Date(`${localDate}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatEventTime(localTime) {
  if (!localTime) return "Time TBA";
  const [h, m] = localTime.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${m} ${ampm}`;
}

function transformTMEvent(event) {
  const venue = event._embedded?.venues?.[0];
  const genre = event.classifications?.[0]?.genre?.name;
  const price = event.priceRanges?.[0]
    ? `$${Math.round(event.priceRanges[0].min)}+`
    : "See site";
  const venueLoc = venue?.location;
  return {
    id: event.id,
    name: event.name,
    venue: venue?.name || "Venue TBA",
    city: venue?.city?.name && venue?.state?.stateCode ? `${venue.city.name}, ${venue.state.stateCode}` : "",
    date: formatEventDate(event.dates?.start?.localDate),
    time: formatEventTime(event.dates?.start?.localTime),
    ages: "Check venue",
    genres: genre && genre !== "Undefined" ? [genre] : ["Live Music"],
    match: null, // real match-scoring isn't wired up yet — see business logic notes
    detour: null, // filled in below once we know the venue's distance from the route
    price,
    source: "Ticketmaster",
    ticketUrl: event.url,
    why: ["Found along your route via Ticketmaster", "Tickets available"],
    nearby: buildNearbyLinks(venue?.city?.name && venue?.state?.stateCode ? `${venue.city.name}, ${venue.state.stateCode}` : ""),
    _lat: venueLoc ? parseFloat(venueLoc.latitude) : null,
    _lon: venueLoc ? parseFloat(venueLoc.longitude) : null,
  };
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const d1 = new Date(`${start}T00:00:00`);
  const d2 = new Date(`${end}T00:00:00`);
  return Math.round((d2 - d1) / 86400000);
}

async function fetchTicketmasterNear(point, windowStart, windowEnd, label) {
  const startDateTime = windowStart ? `${windowStart}T00:00:00Z` : undefined;
  const endDateTime = windowEnd ? `${windowEnd}T23:59:59Z` : undefined;
  const params = new URLSearchParams({
    apikey: TICKETMASTER_API_KEY,
    classificationName: "music",
    size: "20",
    latlong: `${point.lat},${point.lon}`,
    radius: "35",
    unit: "miles",
  });
  if (startDateTime) params.set("startDateTime", startDateTime);
  if (endDateTime) params.set("endDateTime", endDateTime);
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;
  console.log(`[ShowChaser] Fetching Ticketmaster near ${label} (window ${windowStart} to ${windowEnd}):`, url);
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    console.error(`[ShowChaser] Ticketmaster network error (${label}) — likely blocked (CORS/sandbox):`, networkErr);
    throw new Error(`network-blocked:tm-${label}`);
  }
  console.log(`[ShowChaser] Ticketmaster ${label} response status:`, res.status);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[ShowChaser] Ticketmaster ${label} HTTP ${res.status}:`, body);
    throw new Error(`http-${res.status}:tm-${label}`);
  }
  const json = await res.json();
  console.log(`[ShowChaser] Ticketmaster ${label} events found:`, json?._embedded?.events?.length || 0);
  return json?._embedded?.events || [];
}

async function fetchRealShows({ from, to, depart, arrive }) {
  // Step 1: geocode both endpoints, then get the real driving route between them.
  const [fromCoord, toCoord] = await Promise.all([
    geocodePlace(from, "origin"),
    geocodePlace(to, "destination"),
  ]);
  const routeCoords = await getDrivingRoute(fromCoord, toCoord);

  // Step 2: sample ~6 points along the actual route (not just the two ends).
  const routePoints = sampleRoutePoints(routeCoords, 6);

  // Step 3: estimate which day of the trip you'd actually be near each
  // waypoint (assuming a roughly steady pace from depart to arrive), and
  // only search that waypoint within a day or two of that estimate —
  // not the whole trip's date range. Otherwise a Nebraska waypoint pulls
  // shows from every day of the month, even days you'd already be in Chicago.
  const tripDays = depart && arrive ? daysBetween(depart, arrive) : 0;
  const bufferDays = 1;
  const tmResults = await Promise.allSettled(
    routePoints.map((pt, i) => {
      let windowStart = depart;
      let windowEnd = arrive || depart;
      if (depart && arrive && tripDays > 0) {
        const fraction = i / (routePoints.length - 1);
        const estimatedOffset = Math.round(fraction * tripDays);
        windowStart = addDays(depart, Math.max(0, estimatedOffset - bufferDays));
        windowEnd = addDays(depart, Math.min(tripDays, estimatedOffset + bufferDays));
      }
      return fetchTicketmasterNear(pt, windowStart, windowEnd, `waypoint-${i}`);
    })
  );
  tmResults.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[ShowChaser] Ticketmaster waypoint-${i} failed:`, r.reason);
  });

  const fromLoc = parseCityState(from);
  const toLoc = parseCityState(to);
  const [jbFromRes, jbToRes] = await Promise.allSettled([
    fetchOneJamBase(fromLoc, "origin"),
    fetchOneJamBase(toLoc, "destination"),
  ]);
  [
    ["JamBase origin", jbFromRes],
    ["JamBase destination", jbToRes],
  ].forEach(([label, r]) => {
    if (r.status === "rejected") console.error(`[ShowChaser] ${label} failed:`, r.reason);
  });

  const allFailed = tmResults.every((r) => r.status === "rejected") && jbFromRes.status === "rejected" && jbToRes.status === "rejected";
  if (allFailed) {
    throw tmResults[0]?.reason || jbFromRes.reason;
  }

  const tmCombined = tmResults.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const seen = new Set();
  const dedupedTM = tmCombined.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  const tmShows = dedupedTM.map(transformTMEvent).map((s) => {
    // Real detour: distance in miles from the venue to the nearest sampled
    // route point, converted to a rough drive-time estimate.
    if (s._lat === null || s._lat === undefined || isNaN(s._lat)) return { ...s, detour: null };
    const distances = routePoints.map((pt) => haversineMiles(s._lat, s._lon, pt.lat, pt.lon));
    const minMiles = Math.min(...distances);
    const detourMinutes = Math.round((minMiles / 35) * 60); // rough backroad-speed estimate
    // Position along the route for the map display, based on which sampled
    // point the venue is closest to.
    const nearestIdx = distances.indexOf(minMiles);
    const routePct = routePoints.length > 1 ? Math.round((nearestIdx / (routePoints.length - 1)) * 90) + 5 : 50;
    return { ...s, detour: detourMinutes, routePct };
  });

  const jbFromEvents = jbFromRes.status === "fulfilled" ? jbFromRes.value?.data || jbFromRes.value?.events || [] : [];
  const jbToEvents = jbToRes.status === "fulfilled" ? jbToRes.value?.data || jbToRes.value?.events || [] : [];
  const jbShows = [...jbFromEvents, ...jbToEvents].map(transformJamBaseEvent).map((s, i, arr) => ({
    ...s,
    routePct: arr.length > 1 ? Math.round((i / (arr.length - 1)) * 90) + 5 : 50,
  }));

  return {
    shows: [...tmShows, ...jbShows].sort((a, b) => new Date(a.date) - new Date(b.date)),
    routeCoords,
  };
}

function parseCityState(input) {
  const parts = (input || "").split(",").map((s) => s.trim());
  return { city: parts[0] || "", stateCode: parts[1] || "" };
}



const TOKENS = {
  cream: "#F4EEDF",
  sand: "#E7D9B8",
  sandDark: "#D9C79E",
  pine: "#2E4634",
  pineDark: "#1F3225",
  rust: "#C1440E",
  rustDark: "#9E3609",
  brown: "#6B4A2F",
  ink: "#2A2620",
  sky: "#F0DCC0",
};

const GENRES = ["Jam Bands", "Bluegrass", "Rock", "Indie", "Folk", "Electronic"];

const SHOWS = [
  {
    id: "dirtwire",
    name: "Dirtwire",
    venue: "Ogden Theatre",
    city: "Denver, CO",
    date: "Sat, Jun 14, 2025",
    time: "8:00 PM",
    ages: "All Ages",
    genres: ["Jam Bands", "Electronic"],
    match: 96,
    detour: 12,
    routePct: 18,
    price: "$32+",
    source: "AXS",
    why: ["Along your route", "Matches your music preferences", "Tickets available", "Outdoor-adjacent venue"],
    nearby: [
      { label: "Riverside campground", mins: 6, type: "camp", platform: "Hipcamp" },
      { label: "Local brewery", mins: 4, type: "harvest", platform: "Harvest Hosts" },
      { label: "Downtown hotel", mins: 3, type: "lodge", platform: "Hotels.com" },
    ],
  },
  {
    id: "stringdusters",
    name: "The Infamous Stringdusters",
    venue: "Dillon Amphitheater",
    city: "Dillon, CO",
    date: "Sun, Jun 15, 2025",
    time: "7:30 PM",
    ages: "All Ages",
    genres: ["Bluegrass", "Folk"],
    match: 94,
    detour: 10,
    routePct: 33,
    price: "$28+",
    source: "Tixr",
    why: ["10 min off your route", "Matches your music preferences", "Tickets available", "Scenic mountain venue"],
    nearby: [
      { label: "RV park", mins: 8, type: "camp", platform: "Hipcamp" },
      { label: "Lakeside camping", mins: 5, type: "camp", platform: "Hipcamp" },
      { label: "Diner", mins: 2, type: "info" },
    ],
  },
  {
    id: "billystrings",
    name: "Billy Strings",
    venue: "The Great Saltair",
    city: "Salt Lake City, UT",
    date: "Tue, Jun 16, 2025",
    time: "7:00 PM",
    ages: "All Ages",
    genres: ["Bluegrass", "Jam Bands"],
    match: 95,
    detour: 8,
    routePct: 55,
    price: "$45+",
    source: "Ticketmaster",
    why: ["8 min off your route", "Favorite-artist match", "Tickets available", "Iconic desert venue"],
    nearby: [
      { label: "Campground", mins: 10, type: "camp", platform: "Hipcamp" },
      { label: "Hotel", mins: 4, type: "lodge", platform: "Hotels.com" },
      { label: "Gas + supplies", mins: 2, type: "info" },
    ],
  },
  {
    id: "khruangbin",
    name: "Khruangbin",
    venue: "Grand Sierra Resort",
    city: "Reno, NV",
    date: "Thu, Jun 18, 2025",
    time: "8:00 PM",
    ages: "21+",
    genres: ["Indie", "Electronic"],
    match: 92,
    detour: 15,
    routePct: 78,
    price: "$55+",
    source: "AXS",
    why: ["15 min off your route", "Matches your music preferences", "Tickets available", "Resort venue"],
    nearby: [
      { label: "Casino hotel", mins: 1, type: "lodge", platform: "Hotels.com" },
      { label: "RV park", mins: 12, type: "camp", platform: "Hipcamp" },
      { label: "Late-night eats", mins: 3, type: "info" },
    ],
  },
  {
    id: "phish",
    name: "Phish",
    venue: "Shoreline Amphitheatre",
    city: "Mountain View, CA",
    date: "Fri, Jun 20, 2025",
    time: "7:00 PM",
    ages: "All Ages",
    genres: ["Jam Bands", "Rock"],
    match: 99,
    detour: 0,
    routePct: 96,
    price: "$68+",
    source: "Ticketmaster",
    why: ["Right on your route", "Favorite-artist match", "Tickets available", "Amphitheater venue"],
    nearby: [
      { label: "Vineyard campground", mins: 6, type: "harvest", platform: "Harvest Hosts" },
      { label: "Local brewery", mins: 4, type: "harvest", platform: "Harvest Hosts" },
      { label: "Hotel", mins: 3, type: "lodge", platform: "Hotels.com" },
    ],
  },
];

const RECENT_TRIPS = [
  { from: "Boulder", to: "Telluride", dates: "May 23 – May 26" },
  { from: "Boulder", to: "Las Vegas", dates: "Apr 10 – Apr 14" },
  { from: "Denver", to: "Moab", dates: "Mar 28 – Mar 31" },
];

function MatchBadge({ match, size = "md" }) {
  const big = size === "lg";
  if (match === null || match === undefined) {
    return (
      <div
        className="flex items-center justify-center rounded-full shrink-0"
        style={{ width: big ? 56 : 44, height: big ? 56 : 44, background: TOKENS.sand, border: `1px solid ${TOKENS.sandDark}` }}
      >
        <Ticket size={big ? 20 : 16} color={TOKENS.brown} />
      </div>
    );
  }
  return (
    <div
      className="flex flex-col items-center justify-center rounded-full shrink-0"
      style={{
        width: big ? 56 : 44,
        height: big ? 56 : 44,
        background: TOKENS.pine,
        color: TOKENS.cream,
      }}
    >
      <span style={{ fontSize: big ? 16 : 13, fontWeight: 800, lineHeight: 1 }}>{match}%</span>
      <span style={{ fontSize: 7, letterSpacing: 0.5, opacity: 0.8 }}>MATCH</span>
    </div>
  );
}

function SourceTag({ source }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded"
      style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: TOKENS.brown, background: TOKENS.sand }}
    >
      via {source}
    </span>
  );
}

function ShowThumb({ genres, size = 64 }) {
  // Stylized placeholder art keyed to genre, avoids fake photos.
  const hue = genres.includes("Electronic") ? TOKENS.rust : genres.includes("Bluegrass") ? TOKENS.brown : TOKENS.pineDark;
  return (
    <div
      className="rounded-xl shrink-0 flex items-center justify-center relative overflow-hidden"
      style={{ width: size, height: size, background: `linear-gradient(155deg, ${hue}, ${TOKENS.ink})` }}
    >
      <Music size={size * 0.36} color={TOKENS.cream} strokeWidth={1.5} style={{ opacity: 0.9 }} />
    </div>
  );
}

function TopBar({ title, onBack, right }) {
  return (
    <div className="flex items-center justify-between px-5 pt-5 pb-3">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="p-1 -ml-1 rounded-full active:opacity-60">
            <ArrowLeft size={22} color={TOKENS.ink} />
          </button>
        )}
        {title && (
          <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 0.5, color: TOKENS.ink }}>
            {title}
          </h1>
        )}
      </div>
      {right}
    </div>
  );
}

function BottomNav({ active, onChange }) {
  const items = [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "trips", label: "Trips", icon: CalendarIcon },
    { id: "saved", label: "Saved", icon: Bookmark },
    { id: "profile", label: "Profile", icon: User },
  ];
  return (
    <div
      className="flex items-center justify-around border-t"
      style={{ background: TOKENS.cream, borderColor: TOKENS.sandDark, paddingBottom: "env(safe-area-inset-bottom, 8px)" }}
    >
      {items.map((it) => {
        const Icon = it.icon;
        const isActive = active === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className="flex flex-col items-center gap-1 py-2.5 px-3"
          >
            <Icon size={20} color={isActive ? TOKENS.rust : TOKENS.brown} strokeWidth={isActive ? 2.4 : 1.8} />
            <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? TOKENS.rust : TOKENS.brown }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function formatTripDates(depart, arrive) {
  if (!depart) return "No dates set";
  const opts = { month: "short", day: "numeric" };
  const d1 = new Date(`${depart}T00:00:00`).toLocaleDateString("en-US", opts);
  if (!arrive) return d1;
  const d2 = new Date(`${arrive}T00:00:00`).toLocaleDateString("en-US", opts);
  return `${d1} – ${d2}`;
}

/* ---------------- Screens ---------------- */

function HomeScreen({ onFindShows, hasTrip, tripSummary, foundCount }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-6 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="rounded-full flex items-center justify-center"
            style={{ width: 34, height: 34, background: TOKENS.pine }}
          >
            <Mountain size={18} color={TOKENS.rust} strokeWidth={2} />
          </div>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: TOKENS.pine, letterSpacing: 1 }}>
            SHOWCHASER
          </span>
        </div>
        <Bell size={20} color={TOKENS.brown} />
      </div>

      <div className="px-5 pt-3">
        <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, lineHeight: 1.02, color: TOKENS.ink, letterSpacing: 0.3 }}>
          Find live music
          <br />
          along your route.
        </h2>
      </div>

      <div className="px-5 pt-5">
        <div
          className="rounded-2xl p-4"
          style={{ background: TOKENS.sand, border: `1px solid ${TOKENS.sandDark}` }}
        >
          {hasTrip ? (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: TOKENS.ink }}>
                <MapPin size={15} color={TOKENS.rust} />
                {tripSummary.from} → {tripSummary.to}
              </div>
              <div style={{ color: TOKENS.brown, fontSize: 13 }} className="mt-1">
                {tripSummary.dates}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5" style={{ color: TOKENS.rust, fontSize: 13, fontWeight: 700 }}>
                <Music size={13} /> {foundCount} shows found
              </div>
            </>
          ) : (
            <div style={{ color: TOKENS.brown, fontSize: 13 }}>
              No trip planned yet — tell us where you're headed and we'll find the music along the way.
            </div>
          )}
          <button
            onClick={onFindShows}
            className="w-full mt-3 rounded-xl py-3 font-bold text-sm flex items-center justify-center gap-2 active:opacity-90"
            style={{ background: TOKENS.rust, color: TOKENS.cream }}
          >
            <Search size={16} /> {hasTrip ? "View shows" : "Find shows"}
          </button>
        </div>
      </div>

      <div className="px-5 pt-6 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink }}>Recent trips</span>
          <span style={{ fontSize: 12, color: TOKENS.rust, fontWeight: 600 }}>View all</span>
        </div>
        <div className="flex flex-col gap-2 pb-4">
          {RECENT_TRIPS.map((t, i) => (
            <div
              key={i}
              className="rounded-xl p-3 flex items-center gap-3"
              style={{ background: TOKENS.cream, border: `1px solid ${TOKENS.sandDark}` }}
            >
              <div
                className="rounded-lg shrink-0"
                style={{ width: 44, height: 44, background: `linear-gradient(160deg, ${TOKENS.pine}, ${TOKENS.brown})` }}
              />
              <div className="flex-1">
                <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink }}>
                  {t.from} → {t.to}
                </div>
                <div style={{ fontSize: 11.5, color: TOKENS.brown }}>{t.dates}</div>
              </div>
              <ChevronRight size={16} color={TOKENS.brown} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label style={{ fontSize: 11, fontWeight: 700, color: TOKENS.brown, letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function TripFormScreen({ onBack, onSubmit, form, setForm }) {
  const toggleGenre = (g) => {
    setForm((f) => ({
      ...f,
      genres: f.genres.includes(g) ? f.genres.filter((x) => x !== g) : [...f.genres, g],
    }));
  };

  const inputStyle = {
    background: TOKENS.cream,
    border: `1px solid ${TOKENS.sandDark}`,
    color: TOKENS.ink,
  };

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Plan Your Trip" onBack={onBack} />
      <div className="px-5 flex-1 overflow-y-auto pb-4">
        <Field label="From">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={inputStyle}>
            <MapPin size={15} color={TOKENS.rust} />
            <input
              value={form.from}
              onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              className="flex-1 bg-transparent outline-none text-sm"
              placeholder="City, state"
            />
          </div>
        </Field>
        <Field label="To">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={inputStyle}>
            <Navigation size={15} color={TOKENS.rust} />
            <input
              value={form.to}
              onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
              className="flex-1 bg-transparent outline-none text-sm"
              placeholder="City, state"
            />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Depart">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={inputStyle}>
              <CalendarIcon size={14} color={TOKENS.rust} />
              <input
                type="date"
                lang="en-US"
                value={form.depart}
                onChange={(e) => setForm((f) => ({ ...f, depart: e.target.value }))}
                className="flex-1 bg-transparent outline-none text-xs"
              />
            </div>
          </Field>
          <Field label="Arrive">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={inputStyle}>
              <CalendarIcon size={14} color={TOKENS.rust} />
              <input
                type="date"
                lang="en-US"
                value={form.arrive}
                onChange={(e) => setForm((f) => ({ ...f, arrive: e.target.value }))}
                className="flex-1 bg-transparent outline-none text-xs"
              />
            </div>
          </Field>
        </div>

        <Field label="Music preferences">
          <div className="flex flex-wrap gap-2">
            {GENRES.map((g) => {
              const active = form.genres.includes(g);
              return (
                <button
                  key={g}
                  onClick={() => toggleGenre(g)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{
                    background: active ? TOKENS.rust : TOKENS.cream,
                    color: active ? TOKENS.cream : TOKENS.ink,
                    border: `1px solid ${active ? TOKENS.rust : TOKENS.sandDark}`,
                  }}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Maximum detour">
          <div className="flex gap-2">
            {["15 min", "30 min", "60 min", "Unlimited"].map((d) => (
              <button
                key={d}
                onClick={() => setForm((f) => ({ ...f, maxDetour: d }))}
                className="flex-1 py-2 rounded-xl text-xs font-semibold"
                style={{
                  background: form.maxDetour === d ? TOKENS.rust : TOKENS.cream,
                  color: form.maxDetour === d ? TOKENS.cream : TOKENS.ink,
                  border: `1px solid ${form.maxDetour === d ? TOKENS.rust : TOKENS.sandDark}`,
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className="px-5 pb-5 pt-2">
        <button
          onClick={onSubmit}
          className="w-full rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 active:opacity-90"
          style={{ background: TOKENS.rust, color: TOKENS.cream }}
        >
          <Music size={16} /> Show me the music
        </button>
      </div>
    </div>
  );
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function InteractiveRouteMap({ shows, selectedId, onSelect, routeCoords }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  // One pin per venue (many events can share a venue) so the map doesn't
  // stack duplicate markers on top of each other.
  const pins = useMemo(() => {
    const withCoords = shows.filter((s) => typeof s._lat === "number" && !isNaN(s._lat));
    const byVenue = new Map();
    for (const s of withCoords) {
      const key = `${s._lat.toFixed(3)},${s._lon.toFixed(3)}`;
      if (!byVenue.has(key)) byVenue.set(key, s);
    }
    return [...byVenue.values()];
  }, [shows]);

  // Create the map once and tear it down on unmount.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: routeCoords[Math.floor(routeCoords.length / 2)] || [-98.5, 39.8],
      zoom: 4,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw the route line and fit the map to it whenever the route changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeCoords || routeCoords.length === 0) return;

    const drawRoute = () => {
      const geojson = { type: "Feature", geometry: { type: "LineString", coordinates: routeCoords } };
      if (map.getSource("route")) {
        map.getSource("route").setData(geojson);
      } else {
        map.addSource("route", { type: "geojson", data: geojson });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": TOKENS.rust, "line-width": 4, "line-opacity": 0.85 },
        });
      }
      const bounds = routeCoords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(routeCoords[0], routeCoords[0])
      );
      map.fitBounds(bounds, { padding: 50, duration: 0 });
    };

    if (map.isStyleLoaded()) drawRoute();
    else map.once("load", drawRoute);
  }, [routeCoords]);

  // (Re)draw venue markers whenever the pin set or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const placeMarkers = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = pins.map((s) => {
        const isSelected = s.id === selectedId;
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `${s.venue} — ${s.name}`);
        el.style.width = isSelected ? "28px" : "20px";
        el.style.height = isSelected ? "28px" : "20px";
        el.style.borderRadius = "9999px";
        el.style.border = `2px solid ${TOKENS.cream}`;
        el.style.background = isSelected ? TOKENS.rust : TOKENS.pine;
        el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";
        el.style.cursor = "pointer";
        el.style.padding = "0";
        el.onclick = (e) => {
          e.stopPropagation();
          onSelect(s.id);
        };

        const popup = new mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
          `<div style="font:600 12px Inter, sans-serif; color:${TOKENS.ink}">${escapeHtml(s.venue)}<br/><span style="font-weight:400">${escapeHtml(s.name)}</span></div>`
        );

        return new mapboxgl.Marker(el).setLngLat([s._lon, s._lat]).setPopup(popup).addTo(map);
      });
    };

    if (map.isStyleLoaded()) placeMarkers();
    else map.once("load", placeMarkers);
  }, [pins, selectedId, onSelect]);

  // Pan/zoom to whichever show is selected from the results list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId || !map.isStyleLoaded()) return;
    const sel = pins.find((s) => s.id === selectedId);
    if (sel) map.easeTo({ center: [sel._lon, sel._lat], zoom: Math.max(map.getZoom(), 7), duration: 500 });
  }, [selectedId, pins]);

  return <div ref={containerRef} className="w-full h-full" />;
}

function RouteMap({ shows, selectedId, onSelect, routeCoords }) {
  // Real map: when we have an actual driving route (live search), render a
  // genuine interactive Mapbox GL map — draggable/zoomable, with real venue
  // pins the user can tap directly.
  if (routeCoords && routeCoords.length > 0) {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ height: 230, background: TOKENS.sand }}>
        <InteractiveRouteMap shows={shows} selectedId={selectedId} onSelect={onSelect} routeCoords={routeCoords} />
      </div>
    );
  }

  // Stylized fallback: dashed trail across a desert horizon, used for sample
  // data or when live search hasn't produced real route coordinates.
  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{ height: 230, background: `linear-gradient(180deg, ${TOKENS.sky} 0%, ${TOKENS.sand} 65%, ${TOKENS.sandDark} 100%)` }}
    >
      <svg viewBox="0 0 400 230" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <polygon points="0,150 60,95 110,150" fill={TOKENS.pineDark} opacity="0.25" />
        <polygon points="70,155 140,80 210,155" fill={TOKENS.pineDark} opacity="0.35" />
        <polygon points="190,150 260,100 320,150" fill={TOKENS.brown} opacity="0.25" />
        <path
          d="M 20 190 C 100 160, 140 200, 200 150 S 320 120, 380 60"
          fill="none"
          stroke={TOKENS.rustDark}
          strokeWidth="3"
          strokeDasharray="2 8"
          strokeLinecap="round"
        />
      </svg>
      {/* start/end markers */}
      <div className="absolute" style={{ left: "5%", bottom: 14 }}>
        <div className="w-3 h-3 rounded-full" style={{ background: TOKENS.pine, border: `2px solid ${TOKENS.cream}` }} />
      </div>
      <div className="absolute" style={{ right: "5%", top: 20 }}>
        <div className="w-3 h-3 rounded-full" style={{ background: TOKENS.pine, border: `2px solid ${TOKENS.cream}` }} />
      </div>
      {shows.map((s) => {
        const left = `${8 + s.routePct * 0.84}%`;
        const top = `${68 - s.routePct * 0.4}%`;
        const isSel = s.id === selectedId;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center"
            style={{ left, top }}
          >
            <div
              className="rounded-full flex items-center justify-center shadow"
              style={{
                width: isSel ? 30 : 24,
                height: isSel ? 30 : 24,
                background: TOKENS.rust,
                border: `2px solid ${TOKENS.cream}`,
                transition: "all 0.15s",
              }}
            >
              <Music size={isSel ? 14 : 11} color={TOKENS.cream} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ResultsScreen({ onBack, shows, view, setView, onOpenShow, form, usingLiveData, fetchError, routeCoords }) {
  const sorted = useMemo(() => [...shows].sort((a, b) => (b.match ?? 0) - (a.match ?? 0)), [shows]);
  const [selectedId, setSelectedId] = useState(sorted[0]?.id);
  const selected = sorted.find((s) => s.id === selectedId) || sorted[0];

  return (
    <div className="flex flex-col h-full">
      <TopBar
        onBack={onBack}
        title={null}
        right={null}
      />
      <div className="px-5 -mt-1 pb-2">
        <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink }}>
          {form.from || "Boulder, CO"} → {form.to || "San Francisco, CA"}
        </div>
        <div style={{ fontSize: 11.5, color: TOKENS.brown }}>
          {sorted.length} shows found · {usingLiveData ? "Sorted by date" : "Sorted by best match"}
        </div>
        <div className="mt-1.5">
          {usingLiveData ? (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full"
              style={{ fontSize: 10, fontWeight: 700, color: TOKENS.cream, background: TOKENS.pine }}
            >
              ● Live results
            </span>
          ) : (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full"
              style={{ fontSize: 10, fontWeight: 700, color: TOKENS.brown, background: TOKENS.sand }}
            >
              Sample data
            </span>
          )}
        </div>
        {fetchError && (
          <div style={{ fontSize: 11, color: TOKENS.rust, marginTop: 4 }}>{fetchError}</div>
        )}
      </div>

      <div className="px-5 flex-1 overflow-y-auto pb-2">
        {view === "map" ? (
          <>
            <RouteMap shows={sorted} selectedId={selectedId} onSelect={setSelectedId} routeCoords={routeCoords} />
            {selected && (
              <button
                onClick={() => onOpenShow(selected)}
                className="w-full mt-3 rounded-2xl p-3 flex items-center gap-3 text-left"
                style={{ background: TOKENS.sand, border: `1px solid ${TOKENS.sandDark}` }}
              >
                <ShowThumb genres={selected.genres} size={56} />
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: TOKENS.brown }}>
                    {selected.venue} · {selected.city}
                  </div>
                  <div style={{ fontSize: 11.5, color: TOKENS.rust, fontWeight: 700 }}>
                    {selected.date} · {selected.detour === null || selected.detour === undefined ? "Near your trip" : selected.detour === 0 ? "On your route" : `${selected.detour} min detour`}
                  </div>
                  <div className="mt-1">
                    <SourceTag source={selected.source} />
                  </div>
                </div>
                <MatchBadge match={selected.match} />
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2.5 pt-1">
            {sorted.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenShow(s)}
                className="w-full rounded-2xl p-3 flex items-center gap-3 text-left"
                style={{ background: TOKENS.cream, border: `1px solid ${TOKENS.sandDark}` }}
              >
                <ShowThumb genres={s.genres} size={56} />
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: TOKENS.brown }}>
                    {s.venue} · {s.city}
                  </div>
                  <div style={{ fontSize: 11.5, color: TOKENS.rust, fontWeight: 700 }}>
                    {s.date} · {s.detour === null || s.detour === undefined ? "Near your trip" : s.detour === 0 ? "0 min detour" : `${s.detour} min detour`}
                  </div>
                  <div className="mt-1">
                    <SourceTag source={s.source} />
                  </div>
                </div>
                <MatchBadge match={s.match} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 px-5 py-3">
        {[
          { id: "map", label: "Map", icon: MapIcon },
          { id: "list", label: "List", icon: ListIcon },
        ].map((v) => {
          const Icon = v.icon;
          const active = view === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold"
              style={{
                background: active ? TOKENS.pine : TOKENS.sand,
                color: active ? TOKENS.cream : TOKENS.brown,
              }}
            >
              <Icon size={13} /> {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShowDetailScreen({ show, onBack, saved, onToggleSave }) {
  if (!show) return null;
  const isSaved = saved.includes(show.id);
  return (
    <div className="flex flex-col h-full">
      <TopBar
        onBack={onBack}
        right={
          <div className="flex items-center gap-3">
            <Share2 size={19} color={TOKENS.brown} />
            <button onClick={() => onToggleSave(show.id)}>
              <Heart size={20} color={TOKENS.rust} fill={isSaved ? TOKENS.rust : "none"} />
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div
          className="rounded-2xl w-full flex items-center justify-center mb-4 relative overflow-hidden"
          style={{ height: 150, background: `linear-gradient(155deg, ${TOKENS.pineDark}, ${TOKENS.rustDark})` }}
        >
          <Music size={44} color={TOKENS.cream} strokeWidth={1.3} style={{ opacity: 0.85 }} />
        </div>

        <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: TOKENS.ink, letterSpacing: 0.5 }}>
          {show.name}
        </h1>
        <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.brown }}>{show.venue}</div>
        <div style={{ fontSize: 12.5, color: TOKENS.brown }} className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1"><CalendarIcon size={12} /> {show.date}</span>
          <span>{show.time}</span>
          <span>{show.ages}</span>
        </div>
        <div className="mt-1.5">
          <SourceTag source={show.source} />
        </div>

        <div
          className="mt-4 rounded-xl px-3.5 py-2.5 flex items-center justify-between"
          style={{ background: TOKENS.sand }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: TOKENS.ink }}>
            {show.detour === null || show.detour === undefined ? "Near your trip cities" : show.detour === 0 ? "Right on your route" : `${show.detour} minutes off your route`}
          </span>
          <MatchBadge match={show.match} />
        </div>

        <div className="mt-5">
          <div style={{ fontSize: 11, fontWeight: 700, color: TOKENS.brown, letterSpacing: 0.4 }}>WHY THIS MATCHES</div>
          <div className="flex flex-col gap-1.5 mt-2">
            {show.why.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Sparkles size={12} color={TOKENS.rust} />
                <span style={{ fontSize: 13, color: TOKENS.ink }}>{w}</span>
              </div>
            ))}
          </div>
        </div>

        {show.nearby.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 11, fontWeight: 700, color: TOKENS.brown, letterSpacing: 0.4 }}>NEARBY</span>
              <span style={{ fontSize: 11.5, color: TOKENS.rust, fontWeight: 700 }}>View map</span>
            </div>
            <div className="flex flex-col gap-2 mt-2">
              {show.nearby.map((n, i) => {
                const cta =
                  n.type === "camp" || n.type === "lodge" ? "Book" : n.type === "harvest" ? "View" : null;
                return (
                  <div key={i} className="flex items-center justify-between">
                    <div>
                      <div style={{ fontSize: 13, color: TOKENS.ink }}>{n.label}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span style={{ fontSize: 11.5, color: TOKENS.brown }}>
                          {typeof n.mins === "number"
                            ? `${n.mins} min${n.type === "harvest" ? " · free stay for members" : ""}`
                            : n.type === "harvest"
                            ? "Free stay for members"
                            : "Search results"}
                        </span>
                        {n.platform && <SourceTag source={n.platform} />}
                      </div>
                    </div>
                    {cta && (
                      <button
                        onClick={() => n.url && window.open(n.url, "_blank", "noopener,noreferrer")}
                        className="px-3 py-1.5 rounded-full text-xs font-bold shrink-0"
                        style={{
                          background: n.type === "harvest" ? TOKENS.pine : TOKENS.sand,
                          color: n.type === "harvest" ? TOKENS.cream : TOKENS.ink,
                        }}
                      >
                        {cta}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pb-5 pt-2 flex flex-col gap-2">
        <button
          onClick={() => show.ticketUrl && window.open(show.ticketUrl, "_blank")}
          className="w-full rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: TOKENS.rust, color: TOKENS.cream }}
        >
          <Ticket size={16} /> Get tickets · {show.price}
        </button>
        <div className="flex gap-2">
          <button
            className="flex-1 rounded-xl py-2.5 font-semibold text-xs"
            style={{ background: TOKENS.sand, color: TOKENS.ink, border: `1px solid ${TOKENS.sandDark}` }}
          >
            Add to trip
          </button>
          <button
            className="flex-1 rounded-xl py-2.5 font-semibold text-xs"
            style={{ background: TOKENS.sand, color: TOKENS.ink, border: `1px solid ${TOKENS.sandDark}` }}
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- App shell ---------------- */

export default function ShowChaserApp() {
  const [screen, setScreen] = useState("home"); // home | trip | results | detail
  const [navActive, setNavActive] = useState("home");
  const [view, setView] = useState("map");
  const [saved, setSaved] = useState([]);
  const [hasTrip, setHasTrip] = useState(false);
  const [selectedShow, setSelectedShow] = useState(null);
  const [liveShows, setLiveShows] = useState(null); // null = no live fetch yet
  const [liveRouteCoords, setLiveRouteCoords] = useState(null);
  const [loadingShows, setLoadingShows] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [form, setForm] = useState({
    from: "Boulder, CO",
    to: "San Francisco, CA",
    depart: "2026-09-01",
    arrive: "2026-09-30",
    genres: ["Jam Bands", "Bluegrass"],
    maxDetour: "30 min",
  });

  const sampleFiltered = useMemo(() => {
    if (form.genres.length === 0) return SHOWS;
    return SHOWS.filter((s) => s.genres.some((g) => form.genres.includes(g)));
  }, [form.genres]);

  const filteredShows = liveShows !== null ? liveShows : sampleFiltered;
  const usingLiveData = liveShows !== null && liveShows.length > 0;

  const toggleSave = (id) => {
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  // Guards against a race condition: if the user navigates back and searches
  // again before a slower earlier request finishes, that stale response
  // could land AFTER the newer one and silently overwrite it — causing the
  // shows/pins/count to flicker between searches. Each search gets a unique
  // id; only the response matching the current id is ever applied.
  const searchIdRef = useRef(0);

  const handleFindShows = async () => {
    const thisSearchId = ++searchIdRef.current;
    setHasTrip(true);
    setScreen("results");
    setLoadingShows(true);
    setFetchError(null);
    try {
      const { shows: results, routeCoords } = await fetchRealShows(form);
      if (searchIdRef.current !== thisSearchId) {
        console.log("[ShowChaser] Ignoring stale search result", thisSearchId, "current is", searchIdRef.current);
        return;
      }
      setLiveShows(results.length > 0 ? results : null);
      setLiveRouteCoords(results.length > 0 ? routeCoords : null);
      if (results.length === 0) setFetchError("No live results for these cities/dates — showing sample shows instead.");
    } catch (e) {
      if (searchIdRef.current !== thisSearchId) return;
      console.error("[ShowChaser] Live search failed:", e);
      const msg = String(e.message || "");
      if (msg.startsWith("network-blocked")) {
        setFetchError("Live search is blocked in this environment — showing sample shows instead.");
      } else if (msg.includes("geocode")) {
        setFetchError("Couldn't find one of those cities — check spelling (e.g. \"Boulder, CO\") and try again.");
      } else if (msg.includes("directions")) {
        setFetchError("Couldn't calculate a driving route between those cities — showing sample shows instead.");
      } else {
        setFetchError("Live search request failed — showing sample shows instead.");
      }
      setLiveShows(null);
      setLiveRouteCoords(null);
    } finally {
      if (searchIdRef.current === thisSearchId) setLoadingShows(false);
    }
  };

  return (
    <div
      className="w-full flex justify-center"
      style={{ background: "#EDE4CF", minHeight: 600, padding: "24px 12px", fontFamily: "'Inter', sans-serif" }}
    >
      <style>{FONT_IMPORT}</style>
      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          width: 390,
          height: 720,
          background: TOKENS.cream,
          borderRadius: 36,
          boxShadow: "0 20px 60px rgba(31,50,37,0.25)",
          border: `8px solid ${TOKENS.ink}`,
        }}
      >
        <div className="flex-1 overflow-hidden">
          {screen === "home" && (
            <HomeScreen
              hasTrip={hasTrip}
              tripSummary={{ from: form.from, to: form.to, dates: formatTripDates(form.depart, form.arrive) }}
              foundCount={filteredShows.length}
              onFindShows={() => setScreen("trip")}
            />
          )}
          {screen === "trip" && (
            <TripFormScreen
              form={form}
              setForm={setForm}
              onBack={() => setScreen("home")}
              onSubmit={handleFindShows}
            />
          )}
          {screen === "results" && loadingShows && (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
              <Music size={28} color={TOKENS.rust} className="animate-pulse" />
              <span style={{ fontSize: 13, fontWeight: 600, color: TOKENS.brown }}>
                Searching live shows near {form.from} and {form.to}…
              </span>
            </div>
          )}
          {screen === "results" && !loadingShows && (
            <ResultsScreen
              onBack={() => setScreen("home")}
              shows={filteredShows}
              view={view}
              setView={setView}
              form={form}
              usingLiveData={usingLiveData}
              fetchError={fetchError}
              routeCoords={usingLiveData ? liveRouteCoords : null}
              onOpenShow={(s) => {
                setSelectedShow(s);
                setScreen("detail");
              }}
            />
          )}
          {screen === "detail" && (
            <ShowDetailScreen
              show={selectedShow}
              saved={saved}
              onToggleSave={toggleSave}
              onBack={() => setScreen("results")}
            />
          )}
        </div>
        {(screen === "home") && (
          <BottomNav
            active={navActive}
            onChange={(id) => {
              setNavActive(id);
              if (id === "home") setScreen("home");
            }}
          />
        )}
      </div>
    </div>
  );
}
