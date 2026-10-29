# FR24 Gateway — Cloudflare Worker

One Worker (`worker.js`, plain JS) that answers every FlightRadar24 lookup the
app uses, in the APP's shapes.

**FR24 judges whoever CALLS the Worker, not the Worker.** FR24 sits behind
Cloudflare, and for a Worker's subrequest into another Cloudflare site
Cloudflare carries the original caller's bot signals through ("Bot Management
fields … represent the eyeball (end-user) connection"). So the same Worker,
headers and endpoints answer or are challenged depending on who called it:

| Caller | Measured 29 Oct 2026 |
|---|---|
| a pilot's browser opening the Worker URL | every route answers (`/aircraft`, `/airport/details`, `traffic-stats`, `/probe`) |
| a Vercel route on the **Edge** runtime | every call answered — search, `/aircraft`, `/airport` (VOBZ, WBGG, VTZ; ZZZQ a genuine 404) |
| a Vercel route on the **Node** runtime | every call challenged (403 → the Worker's 502), on every endpoint |
| a server or CI job calling it with curl | challenged almost every time |

That is why every app route that calls this Worker runs on Edge. The same
search call was challenged at one data centre and answered at another seconds
later, but the clean split in the logs is the CALLER, not the data centre.

FR24 changes what it challenges without notice (the airport lookup,
`/airports/traffic-stats/`, stopped answering this way), so every lookup the
app depends on is a **chain of independent sources**, and `GET /probe` says
which of them answer from the Worker right now.

## `/probe` measures its caller

`/probe` asks every upstream once, and FR24 scores those calls by whoever
called `/probe`. Run from a browser it reports what a browser gets; run from a
server or CI it reports that server, which is challenged on nearly everything.
An earlier version of this file concluded from a server-side `/probe` that
"every FR24 JSON endpoint challenges the Worker". That was wrong: it measured
the caller.

Independent of the caller: the official API (`fr24api.flightradar24.com`)
answers 401 "No API key". It is FR24's paid, keyed API, and the one route that
does not depend on how FR24 scores a caller. FR24's web-client gRPC API
(`data-feed.flightradar24.com`) is not used: it answered only with FR24's own
web-client headers, which is a way round the protection.

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
| `/airport?code=WSSS` | airport by ICAO or IATA | `airport.json` + `traffic-stats` (both carry the timezone) → `_json/airports.php` + search (position only; `timezone` is `""`, which the app derives from the coordinates) |
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
| `app/api/search/airport` (Edge) | `/airport` (falls back to the legacy passthrough on an older Worker); the browser derives a missing timezone (`lib/airports/online-lookup.ts`) |
| `app/api/search/aircraft` (Edge) | the legacy search first (as always), then `/aircraft` when it finds nothing |
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

   Every `FAIL` line is a source FR24 challenges **for that caller**. Run it
   from a server and almost everything fails; that is the server being scored,
   not the app (see "`/probe` measures its caller").

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
