# FR24 Search Proxy — Cloudflare Worker

A tiny Worker that proxies `flightradar24.com/v1/search/web/find` from
Cloudflare's network. The Next.js app's server-side fetch (Node and Vercel
Edge) both get 403'd by Cloudflare's "Just a moment..." JS challenge on this
endpoint; this Worker is the next-cheapest hop to try because Worker fetch
uses a different TLS stack and runs on Cloudflare's own network.

**No guarantee this passes the challenge** — if the Worker also gets 403,
the next escalation is a paid scraping API (ScraperAPI / ZenRows / etc.).

## One-time setup

1. Create a free Cloudflare account at https://cloudflare.com (no credit
   card required for Workers free tier — 100k requests/day).

2. Install wrangler locally (or use the dashboard, see "Dashboard deploy"
   below):

   ```bash
   npm install -g wrangler
   wrangler login
   ```

3. From this directory:

   ```bash
   cd cloudflare-worker
   wrangler deploy
   ```

   This deploys the Worker to `https://fr24-search-proxy.<your-subdomain>.workers.dev`.
   Copy that URL.

4. Set a shared secret so the Worker isn't open to anyone hitting your URL
   (and burning your free-tier quota):

   ```bash
   wrangler secret put PROXY_SECRET
   # Paste any random string when prompted, e.g. `openssl rand -hex 32`
   ```

5. In your Vercel project's environment variables, add:
   - `FR24_PROXY_URL` = the workers.dev URL from step 3
   - `FR24_PROXY_SECRET` = the same secret from step 4

   Redeploy Vercel (or trigger a new deploy) so the env vars apply.

## Dashboard deploy (no CLI)

If you'd rather not use wrangler:

1. Cloudflare dashboard → Workers & Pages → Create application → Create Worker.
2. Name it `fr24-search-proxy`.
3. Edit the Worker, paste the contents of `worker.ts` (the dashboard editor
   accepts TS). Save and deploy.
4. Workers & Pages → your worker → Settings → Variables and Secrets →
   Add Variable → Type: Secret → Name: `PROXY_SECRET`, Value: your random
   string. Save.
5. The Worker URL is shown at the top of the Worker page — copy it.
6. Add `FR24_PROXY_URL` and `FR24_PROXY_SECRET` to Vercel env vars as above.

## Verifying

After deploy and Vercel env vars are set, hit:

```
https://<vercel-app>/api/search/aircraft?q=9V-TNL&debug=1
```

The `debug.attempts[0]` should now show:

- `status: 200`
- `contentType: application/json…`
- `hits: 1`

If you still see `status: 502` (Worker reached, but FR24 rejected) or
`status: 401` (Worker rejected — secret mismatch), check the corresponding
env var.

## Notes

- The Worker only allows `GET /v1/search/web/find` requests — anything
  else returns 400. That's deliberate: keep the surface area tiny so the
  Worker can't be used as an open FR24 proxy.
- The `cf: { cacheTtl: 0 }` block disables Cloudflare's edge cache for
  this fetch. Aircraft data changes infrequently but query patterns differ,
  so caching at the Worker layer adds little value and would mask FR24's
  real response during debugging.
