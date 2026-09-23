# clash-config

A config generator that turns a proxy subscription into a China-friendly
Clash config with service-specific proxy groups (AI, Steam, Google, YouTube, Social,
Telegram, Netflix, Slack, Microsoft, Apple, Developer) and rules from
[Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) and
[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script).

The interface is a **Vercel-hosted subscription endpoint**
([`api/subscribe.ts`](api/subscribe.ts)): point any Clash-compatible client
at the deployed URL and it gets the rewritten config directly.

## Subscription service (Vercel)

[`api/subscribe.ts`](api/subscribe.ts) is the HTTP layer — auth, upstream
fetch, YAML parse/dump. [`api/rewrite.ts`](api/rewrite.ts) holds all config
generation: proxy groups, rules, rule providers, DNS and sniffer. **Change
routing behavior there**.

The generated config is **self-contained**. It carries its own `dns` and
`sniffer` sections and does not rely on client-side override toggles (such as
Clash Party's DNS Override / sniff override sidebar switches), so it works
as-is in Stash, mihomo, and Clash Verge.

Normal service groups default to **⚡ AUTO**, a fallback group ordered
Hysteria2 → SS2022 → REALITY. HTTPS health checks run every 60 seconds.
AnyTLS remains available in **🚀 MANUAL**, but is excluded from automatic
selection because it showed repeated TLS resets on the current route.

The public addresses in `SERVER_HOSTS` pin straw's proxy endpoints so local
DNS cannot redirect them. Update this map in `api/rewrite.ts` if straw moves.
Proxy credentials, TLS SNI, and certificate verification are preserved.
Foreign DNS-over-HTTPS queries go **through ⚡ AUTO**, while direct traffic
uses domestic resolvers. This avoids trying to reach blocked foreign DNS
before a proxy connection exists.

The user-facing `sub.tsonubin.com/api/subscribe` URL is forwarded by nginx on
straw (`/etc/nginx/sites-enabled/clash-subscription`) to this Vercel project.
After deploying, refresh the existing subscription in Clash Party and select
**⚡ AUTO** for service groups if a previous manual selection was remembered.

Note that QUIC-based protocols (hysteria2) allocate the same per-connection
buffers in whichever core ultimately runs them; generating config server-side
does not change core runtime behavior.

### AI relay (optional)

Setting `RELAY_HOST` / `RELAY_USERNAME` / `RELAY_PASSWORD` adds a `US-RELAY`
SOCKS5 proxy and points the 🤖 AI group at it, giving AI services a stable US
egress:

- **🛰 AI-ROUTE** (`fallback`) tries `US-RELAY` first, then **↩ AI-FALLBACK**
  (a `fallback` over the normal nodes) if the relay stops answering
  healthchecks — so a dead relay degrades instead of black-holing AI traffic.
- `US-RELAY` sets `dialer-proxy: ⚡ AUTO`, so it is reached *through* your own
  nodes rather than from the client's raw network. The relay is deliberately
  excluded from `⚡ AUTO`, otherwise that would loop.

All three of host/username/password must be set; otherwise the relay and both
AI-* groups are omitted and AI traffic uses the normal nodes. Credentials are
read from the environment because the served config contains them in
plaintext — which is what `SUBSCRIBE_TOKEN` guards.

### Deploy

1. `vercel link` (or `vercel deploy` the first time) from this directory.
2. Set environment variables (`vercel env add <NAME>` or via the dashboard) —
   see [`.env.example`](.env.example) for the full list:
   - `SUBSCRIPTION_URL` — your upstream subscription URL. Keep this
     server-side only; it's typically a credential.
   - `SUBSCRIBE_TOKEN` — a shared secret required as `?token=` on the
     endpoint, so the deployed URL can't be scraped for your relay
     credentials by anyone who finds it (`openssl rand -hex 24`).
   - `RELAY_HOST` / `RELAY_PORT` / `RELAY_USERNAME` / `RELAY_PASSWORD` —
     optional SOCKS5 relay for AI egress (see below). Omit to disable.
3. `vercel deploy --prod`.
4. Subscribe your client to:
   `https://<your-project>.vercel.app/api/subscribe?token=<SUBSCRIBE_TOKEN>`

### Local development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # subscription routing regressions
vercel dev          # requires the Vercel CLI; reads .env.local
```

## Usage tips

- **🌍 GLOBAL** — default route for general proxy traffic (`MATCH`, GFW, etc.).
- **Service groups** (AI, LinkedIn, Zoom, …) — switch each service independently.
- **⚡ AUTO** — url-test across all subscription nodes; good default for most groups.

## Troubleshooting

- **No proxies found** — ensure your upstream subscription has at least one proxy node.
- **Service not proxying** — set that service's group to **⚡ AUTO** in the proxy panel.
- **AI relay not working** — verify `RELAY_HOST`, `RELAY_USERNAME`, and `RELAY_PASSWORD` are all set. If any are missing, the relay is omitted entirely.
- **`[Provider] slack pull error: 400 Bad Request`** — caused by a double slash in the blackmatrix7 ruleset URL. This is handled correctly in the current code.
