# ShowChaser — Project Context

Road-trip live music discovery app. Tagline: "Never Miss a Show on the Road."
Finds concerts/festivals along a user's actual driving route (not just their
two endpoint cities), based on trip dates and music preferences.

## Current state

Live prototype deployed at showchaser.vercel.app (Vercel, auto-deploys from
the `main` branch of github.com/gitchrisgreco/showchaser). Root directory in
Vercel is set to `showchaser-app` (the project is nested one folder deep in
the repo). Single-file React app at `showchaser-app/src/App.jsx`, built with
Vite + Tailwind + lucide-react icons.

Real data is wired in and working end-to-end: given a from/to city and trip
dates, the app geocodes both cities, gets the actual driving route, samples
points along it, and searches for real shows near each point — not just the
two endpoints. Results show real venues, real dates, real ticket links, and
computed detour minutes per show. There's also a real static map (Mapbox
Static Images API) showing the actual route line and venue pins.

## Tech stack

- Vite + React 18, single component file (`App.jsx`, ~1200 lines)
- Tailwind (core utility classes only, no compiler)
- lucide-react for icons
- No backend — everything is client-side fetch calls directly from the browser
- Deployed via Vercel, connected to GitHub for auto-deploy on push to `main`

## Data sources (all API keys currently hardcoded in App.jsx — see below)

**Ticketmaster Discovery API** — primary, confirmed working.
- Free dev tier, 5,000 calls/day
- Uses real geo-radius search (`latlong` + `radius` params), not just city name
- This is what makes true route-based search possible
- Scope: searches within ~35mi of each sampled route point

**JamBase Data API** — wired in but UNCONFIRMED working.
- Free Developer tier (non-commercial, 1,000 calls/mo)
- Their docs are JS-rendered and couldn't be scraped to verify exact query
  param names, so the integration uses a best-guess (`city`/`stateCode`
  convention). Only Ticketmaster results have shown up in testing so far —
  JamBase may be silently failing on wrong params. Check console logs
  (`[ShowChaser] JamBase ... response status`) for the real HTTP status.
  Their "Request Builder" tool on data.jambase.com would show correct params.
- Business note: free tier is non-commercial only. Startup tier ($6,000/yr,
  $500/mo) is the real launch-time cost once the app is commercial/monetized.

**Mapbox** — geocoding + driving directions + static map images.
- Free tier: 100k geocoding + 100k directions requests/mo, no card required
- Used for: turning city names into coordinates, getting the real route,
  sampling waypoints along it, and rendering the static map image

**AXS, Tixr** — no public/self-serve API for either. Both require a direct
partnership conversation (AXS has a "partnerships/integrations" page; Tixr's
API is organizer-scoped, not open discovery). Plan: revisit once the app has
real usage numbers to pitch with — not a launch blocker, since shows on these
platforms should still surface via Ticketmaster/JamBase aggregation, just
without affiliate commission on those specific sales yet.

## API keys — ROTATE BEFORE REAL LAUNCH

All three keys (Ticketmaster, JamBase, Mapbox) are dev/prototype keys that
have been pasted in chat and committed to a **public** GitHub repo. Treat
them as burned. Before any real launch: generate fresh keys in each
platform's dashboard and move them out of the client-side source (ideally
behind a backend/serverless function so they're never in the browser at all —
right now anyone can view-source the deployed site and see them).

## Known bugs fixed so far (context for why the code looks the way it does)

- **Date-window bug**: originally searched every waypoint across the ENTIRE
  trip date range, so e.g. a Nebraska waypoint would pull shows from any day
  of the month, even days the traveler would already be near Chicago. Fixed
  by estimating which day of the trip each waypoint falls on (linear
  interpolation by position along route) and only searching ±1 day around
  that estimate.
- **Pin-truncation bug**: map pins were capped at the first 15 shows sorted
  by date, which clustered all pins near the start of a long trip and never
  reached shows later in the date range near the destination. Fixed by
  deduping by venue location and sampling evenly across route position
  instead of truncating chronologically.
- **Race condition**: navigating back and re-searching could let a slower,
  earlier request's response land AFTER a newer search and silently
  overwrite it, causing show counts/pins to flicker between identical
  searches. Fixed with a request-ID ref that ignores stale responses.

## Known gaps / next steps discussed but not yet built

- **JamBase actually working** — needs param verification (see above)
- **Real match-scoring** — the UI has a match % badge concept from the
  original mockups, but real fetched shows currently show a neutral ticket
  icon instead, since no real scoring algorithm (genre overlap, detour
  distance, favorite artists) has been built yet
- **Interactive map** — current map is a static Mapbox image (no tappable
  pins). User explicitly wants real interactive pins eventually, but decided
  to hold off until closer to launch since it's a bigger lift (would mean
  adding Mapbox GL JS as a real dependency, not just an image URL)
- **Monetization CTAs** — Hotels.com "Book" and Harvest Hosts "View" are now
  wired for real (live) shows too, not just sample data (see
  `buildNearbyLinks` in `App.jsx`). Since there's no lodging/places API
  wired in, these aren't specific named properties — they're real deep
  links to each platform's own public search, built from the venue's city:
  Hotels.com's `search.do?destination=` pattern (long-standing public URL,
  but like JamBase, unconfirmed by an actual click-through — verify before
  launch) and Harvest Hosts' `/discover` map (confirmed public, no login
  required). Neither is a real affiliate link yet — Harvest Hosts pays on
  membership referral, not per-stay, so a real affiliate/referral ID still
  needs to be added once the account exists. Hipcamp is intentionally left
  out of the live wiring — no clean self-serve affiliate path yet, only an
  ambassador program that pays in platform credit, plus VigLink/Sovrn as an
  indirect option.

## Monetization plan (from original pitch deck)

- **Phase 1**: ticket affiliate revenue (Ticketmaster, SeatGeek possible) +
  ShowChaser Pro subscription ($4.99–9.99/mo: unlimited saved trips, artist
  alerts, Spotify integration, route notifications, advanced filters,
  camping/lodging recs)
- **Phase 2**: venue/festival promoted placement, hotel/camping/RV park
  affiliate commissions
- **Phase 3**: venue analytics subscription platform, tourism board
  partnerships

## Target users

Primary: jam band fans, festival travelers, RV/van-life travelers, road
trippers, outdoor adventure enthusiasts. Secondary: general concertgoers,
touring fans, business/weekend travelers. Expected to skew toward smaller
venues/shows more than big arena tours — direct ticket links matter a lot.

## Branding

- Name: ShowChaser (final — considered alternatives, kept this one)
- Palette: desert dusk — deep pine green (#2E4634), terracotta/rust accent
  (#C1440E), sun-bleached sand/cream backgrounds, dashed "trail" motif
- Domain: showchaser.co (owned). showchaser.com is taken (registered via
  Squarespace, privacy-protected) — an offer was placed via DomainAgents,
  outcome unknown/pending.
- Instagram: @show.chaser (showchaser.com wasn't available as a handle)
- Original mockups (uploaded early in the project) show the intended full
  mobile flow: home → trip form → map with shows → results list → show detail

## Trip form specifics

One-way road trips only — Depart and Arrive date fields (not a round-trip
depart/return). Genre chips: Jam Bands, Bluegrass, Rock, Indie, Folk,
Electronic. Max detour selector: 15/30/60 min/unlimited (UI exists, not yet
wired to actually constrain the real search radius — currently hardcoded to
35mi in the Ticketmaster query).
