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

All proxy-needing groups (🌍 GLOBAL, 🐟 FINAL, and every service group except
🍎 Apple) default to **🚀 MANUAL**. MANUAL lists **⚡ AUTO** first, followed by each
individual node, so a single selection in MANUAL steers every service: leave
it on AUTO for automatic node picking, or pin one protocol for everything.
Any service group can still be pointed at AUTO, GLOBAL, a specific node, or
DIRECT on its own.

**⚡ AUTO** is a fallback group ordered Hysteria2 → SS2022 → REALITY with HTTPS
health checks every 60 seconds. AnyTLS remains available in MANUAL and in every
service group, but is excluded from automatic selection because it showed
repeated TLS resets on the current route.

🍎 Apple defaults to DIRECT, 🎯 DIRECT stays DIRECT, and the 🐟 FINAL catch-all
(`MATCH`) defaults to 🚀 MANUAL (with 🌍 GLOBAL, ⚡ AUTO, and DIRECT selectable)
rather than DIRECT, because unmatched traffic is almost always foreign and
DIRECT for it was observed to time out.
Domestic traffic is still sent DIRECT by the `direct` / `cncidr` / `GEOIP,CN`
rules before it ever reaches FINAL.

The public addresses in `SERVER_HOSTS` pin straw's proxy endpoints so local
DNS cannot redirect them. Update this map in `api/rewrite.ts` if straw moves.
Proxy credentials, TLS SNI, and certificate verification are preserved.
Foreign DNS-over-HTTPS queries go **through ⚡ AUTO**, while direct traffic
uses domestic resolvers. This avoids trying to reach blocked foreign DNS
before a proxy connection exists.

The user-facing `sub.tsonubin.com/api/subscribe` URL is forwarded by nginx on
straw (`/etc/nginx/sites-enabled/clash-subscription`) to this Vercel project.
After deploying, refresh the existing subscription in Clash Party. Because
`store-selected` is on, a previously remembered selection can override the new
defaults — set service groups back to **🚀 MANUAL** (and MANUAL to **⚡ AUTO**)
if that happens.

Note that QUIC-based protocols (hysteria2) allocate the same per-connection
buffers in whichever core ultimately runs them; generating config server-side
does not change core runtime behavior.

### AI relay (optional)

Setting `RELAY_HOST` / `RELAY_USERNAME` / `RELAY_PASSWORD` adds a `US-RELAY`
SOCKS5 proxy and offers it inside the 🤖 AI group, giving AI services a stable
US egress on demand. The AI group still defaults to **🚀 MANUAL** like every
other service; pick **🛰 AI-ROUTE** (or `US-RELAY` / **↩ AI-FALLBACK**
directly) in the AI group when you want the relay:

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

### PIN portal

The site root (`/`) is a PIN page that works in a phone or desktop browser.
After the correct PIN, it shows a subscription URL and a large copy button.
Each URL is a fresh random path plus a random key, for example
`https://sub.tsonubin.com/<path>/<key>`. The link works for five minutes
(`LINK_TTL_SECONDS`, default 300) and then the server answers as if it was
never issued, so a copied or probed address does not stay usable.

A small **Administrator** link opens `/admin`. That page asks for
`ADMIN_PASSWORD` (environment variable only) and then writes a new PIN to
`PIN_FILE` (default `data/pin.txt`, one line). Until that file exists, the
gate reads `PORTAL_PIN`. The file is gitignored. On Vercel the project
directory is read-only, so set `PIN_FILE` to a persistent writable path or
keep using `PORTAL_PIN` and change it in the project environment.

The stable `/api/subscribe?token=` endpoint is unchanged for clients that
already have it. New links from the portal do not use that token. Point the
public host at this whole deployment, not only `/api/subscribe`, because the
generated paths live at the site root. `vercel.json` sends those two-segment
paths to the checker and leaves `/api/subscribe` on its own function.

### Deploy

1. `vercel link` (or `vercel deploy` the first time) from this directory.
2. Set environment variables (`vercel env add <NAME>` or via the dashboard) —
   see [`.env.example`](.env.example) for the full list:
   - `SUBSCRIPTION_URL` — your upstream subscription URL. Keep this
     server-side only; it's typically a credential.
   - `SUBSCRIBE_TOKEN` — a shared secret required as `?token=` on the
     stable endpoint, so the deployed URL can't be scraped for your relay
     credentials by anyone who finds it (`openssl rand -hex 24`). Also signs
     portal links when `LINK_SECRET` is unset.
   - `PUBLIC_ORIGIN`, `PORTAL_PIN` or `PIN_FILE`, and `ADMIN_PASSWORD` — the
     root PIN page and the administrator PIN change. See [PIN portal](#pin-portal).
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

- **🚀 MANUAL** — the one switch that steers every service. Leave it on
  **⚡ AUTO** for automatic node picking, or pin a specific node for everything.
- **⚡ AUTO** — health-checked fallback over the subscription nodes
  (Hysteria2 → SS2022 → REALITY; AnyTLS excluded).
- **🌍 GLOBAL** — route for general proxy traffic; defaults to MANUAL.
- **🐟 FINAL** — the `MATCH` catch-all for unmatched (mostly foreign) traffic;
  defaults to MANUAL, with GLOBAL / AUTO / DIRECT selectable.
- **Service groups** (AI, Steam, Google, …) — default to MANUAL; switch any one
  of them to AUTO, GLOBAL, a specific node, or DIRECT independently.
- **🤖 AI** — additionally offers 🛰 AI-ROUTE / `US-RELAY` / ↩ AI-FALLBACK when
  the relay env is configured.

## Troubleshooting

- **No proxies found** — ensure your upstream subscription has at least one proxy node.
- **Service not proxying** — set that service's group back to **🚀 MANUAL** in the proxy panel, and check MANUAL points at **⚡ AUTO** or a working node. A remembered selection from an older config can override the defaults.
- **AI relay not working** — verify `RELAY_HOST`, `RELAY_USERNAME`, and `RELAY_PASSWORD` are all set. If any are missing, the relay is omitted entirely.
- **`[Provider] slack pull error: 400 Bad Request`** — caused by a double slash in the blackmatrix7 ruleset URL. This is handled correctly in the current code.
