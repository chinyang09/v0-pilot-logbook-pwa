# FR24 Gateway — Cloudflare Worker

One Worker (`worker.js`, plain JS) that answers every FlightRadar24 lookup the
app uses, in the APP's shapes. Server-side fetch from Node and Vercel Edge is
403'd by Cloudflare's "Just a moment..." challenge; a Worker's fetch runs on
Cloudflare's own network with a different TLS fingerprint, and gets through
where they do not.

FR24 changes what it challenges without notice (the airport lookup,
`/airports/traffic-stats/`, stopped answering this way), so every lookup the
app depends on is a **chain of independent sources**, and `GET /probe` says
which of them answer from the Worker right now.

## Status — probed 29 Oct 2026 (deployed version `afa3e9cd`)

From the Worker, **every FR24 JSON endpoint now answers Cloudflare's "Just a
moment..." challenge (403)** — `v1/search/web/find`, `traffic-stats`,
`_json/airports.php` + `airlines.php`, `common/v1/airport.json` and
`flight/list.json`, `data-live …/clickhandler`, `webapi/v1/…`, and
`/api/v1/airports/{id}`. A Worker's fetch no longer gets past FR24's bot
management; the old Worker was getting the same 403 on search and
traffic-stats before this one was deployed. The routes that depend on them
answer 502 with their `attempts`.

The challenge is decided per request, not per endpoint: the Worker's logs show
the same search answering 403 at one data centre and 200 at another seconds
later. That is why the app's aircraft lookup still finds things now and then —
it makes up to three search attempts — and why the app's airport route no
longer depends on FR24 alone: it ends in OurAirports open data
(`lib/airports/open-data.ts`).

What still answers without a challenge:

| | Host | Notes |
|---|---|---|
| live positions | `data-cloud.flightradar24.com/zones/fcgi/feed.js` | `/live`, and `/aircraft`'s last tier — only for an aircraft flying now |
| airline logos | `cdn.flightradar24.com/assets/airlines/logotypes/…` | not used by the app |
| the OFFICIAL API | `fr24api.flightradar24.com/api/…` | answers 401 "No API key" — a paid, keyed API; airports, airlines, live positions, flight summaries (takeoff/landing times) |

FR24's web-client gRPC API (`data-feed.flightradar24.com`) also answered, but
only when called with FR24's own web-client headers. It is not used, because
that is a way round the protection FR24 put in front of everything else.

## Routes

All `GET`. With `PROXY_SECRET` set, every route but `/health` needs the
`x-proxy-secret` header. Normalized routes answer:

| Status | Body | Means |
|---|---|---|
| 200 | `{ ok: true, data, source }` | found — `source` names the tier that answered |
| 400 | `{ ok: false, error }` | bad input |
| 404 | `{ ok: false, error }` | a source answered and has no such thing → manual entry |
| 502 | `{ ok: false, error, attempts }` | every source failed (challenge, timeout) → try later |

Add `debug=1` to any route to see each upstream attempt.

| Route | Answers | Chain |
|---|---|---|
| `/health` | liveness | — |
| `/probe` | every upstream once, from here (`code=`, `reg=`, `flight=` set the samples) | — |
| `/aircraft?reg=9V-TNL` | aircraft by registration | search → the registration's flight history → live feed |
| `/aircraft/flights?reg=9V-TNL&page=1&limit=25` | the airframe + the flights it has flown | `common/v1/flight/list.json?fetchBy=reg` |
| `/airport?code=WSSS` | airport by ICAO or IATA | search → `airport.json` → `traffic-stats` → `_json/airports.php`, one at a time — search first because it is the endpoint FR24 challenges least (search and the list give position only; `timezone` is `""`) |
| `/airport/details?code=WSSS` | details, runways, weather | `airport.json` plugins |
| `/airport/schedule?code=WSSS&mode=departures&page=1&limit=50&timestamp=` | departures or arrivals board | `airport.json` schedule plugin |
| `/airports` | every airport | `_json/airports.php` |
| `/airlines` | every airline | `_json/airlines.php` |
| `/search?q=TR600&limit=20` | search, grouped by kind (aircraft, airport, operator, live, schedule) | `v1/search/web/find` |
| `/flight?number=TR600&page=1&limit=25` | the flights a flight number has operated | `common/v1/flight/list.json?fetchBy=flight` |
| `/flight/details?id=<fr24 id>` | one live flight, with its trail | `data-live …/clickhandler` |
| `/live?reg=` / `airline=` / `type=` / `bounds=N,S,W,E` | live positions | `data-cloud …/zones/fcgi/feed.js` |
| `/raw?url=https://api.flightradar24.com/...` | verbatim, FR24 hosts only — **off unless `PROXY_SECRET` is set** | — |
| `/v1/search/web/find`, `/airports/traffic-stats/` | LEGACY verbatim passthroughs, for an app deployment that predates the routes above | — |

Times are ISO-8601 UTC. FR24's "actual" times are its own observation, not the
company's OOOI record.

Answers are cached at the Worker (Cache API, per data centre): airports 7 days,
the airport and airline lists a day, aircraft a day, flight histories 10
minutes, boards 2 minutes. Only a found answer is cached — never a failure.
(The Cache API is a no-op in the dashboard's preview, and may be on a bare
`workers.dev` URL; it is an optimisation only.)

## How the app uses it

| Caller | Route |
|---|---|
| `app/api/search/airport` | `/airport` (falls back to the legacy passthrough on an older Worker), then OurAirports open data, deriving a missing timezone from the coordinates with geo-tz |
| `app/api/search/aircraft` | the legacy search first (as always), then `/aircraft` when it finds nothing |
| `app/api/fr24/[...path]` | any normalized route, for signed-in users — the PWA's door (`lib/fr24/client.ts`) |

The server side reads `FR24_PROXY_URL` + `FR24_PROXY_SECRET`
(`lib/fr24/worker-client.ts`); the secret never reaches a browser.

## Deploy

### Dashboard (no CLI)

1. Workers & Pages → `fr24-search-proxy` → Edit code.
2. Replace the whole file with `worker.js`. Deploy.
3. Settings → Variables and Secrets: keep (or add) the `PROXY_SECRET` secret.
4. Open `https://fr24-search-proxy.<subdomain>.workers.dev/probe` with the
   secret header, e.g.

   ```bash
   curl -s -H "x-proxy-secret: $SECRET" https://fr24-search-proxy.<subdomain>.workers.dev/probe | jq .summary
   ```

   Every `FAIL` line is a source FR24 is challenging from Cloudflare today.

### Wrangler

```bash
cd cloudflare-worker
wrangler deploy
wrangler secret put PROXY_SECRET   # first time only
```

Vercel needs `FR24_PROXY_URL` (the workers.dev URL) and `FR24_PROXY_SECRET`
(the same secret). The Worker can be deployed before or after the app: the
legacy routes keep an older app working, and the app falls back to them on an
older Worker.

## Tests

`__tests__/worker.test.ts` runs in the app's Vitest suite (`pnpm test`): the
normalizers, and each chain against stand-in upstreams — which source answers
when another is challenged, 404 vs 502, that a failure is never cached, and
that `/raw` stays on FR24's hosts. `tsconfig.json` type-checks `worker.js`
against `@cloudflare/workers-types` (`checkJs`).
