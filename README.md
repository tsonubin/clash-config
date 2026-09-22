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
routing behavior there**, not in `archive/`.

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

## Archive

[`archive/`](archive/) holds the original Clash Party JS-override scripts.
They are **frozen and no longer used** — nothing imports them, and they are
excluded from typechecking. They predate the Vercel endpoint, target a
multi-region airport subscription rather than the current single-server
topology, and require Clash Party's DNS Override / sniff override toggles to
work at all. Kept for reference only; make changes in
[`api/rewrite.ts`](api/rewrite.ts) instead.

The instructions below describe that legacy workflow.

### Prerequisites

- [Clash Party](https://clashparty.org/) installed
- A subscription URL (any provider — the script discovers nodes automatically)
- Optional: edit the `US-RELAY` block at the top of `archive/clash-rewrite.js` if you use the AI relay

### 1. Create the override

1. Open **Clash Party**.
2. Go to the **Override** section (override block in the sidebar).
3. Create a new **JavaScript** override.
4. Paste the contents of [`archive/clash-rewrite.js`](archive/clash-rewrite.js) into the editor.
5. Save the override and give it a name (e.g. `clash-rewrite`).

See also: [Clash Party JavaScript override docs](https://clashparty.org/docs/guide/override/javascript).

### 2. Attach the override to your subscription

1. Go to the **Subscription** section (subscription block in the sidebar).
2. **Right-click** the subscription you want to use.
3. Click **Edit info**.
4. Scroll to the bottom.
5. In the **Override** section, click **Add**.
6. Select the override you created in step 1.

### 3. Apply the config

1. Refresh the subscription (update icon or right-click → refresh).
2. Confirm **Mode** is set to **Rule**.
3. Open **Proxy groups** — you should see groups like **🌍 GLOBAL**, **🤖 AI**, **💼 LinkedIn**, etc.

### 4. Enable sidebar overrides

The script configures DNS and sniffer settings in the merged config, but Clash Party applies them only when the matching sidebar toggles are **ON**:

| Sidebar toggle | Chinese UI | Why |
|----------------|------------|-----|
| **DNS Override** | DNS 覆写 | Uses foreign DNS for Google/GFW domains so they resolve to real IPs instead of polluted China addresses. |
| **Override connection address** | 嗅探覆写 | Uses TLS/QUIC sniffing to detect the real domain on IP-only connections and route them to the correct proxy group (e.g. Google → **🔍 Google** instead of **DIRECT**). |

With **TUN** (虚拟网卡) enabled, **Override connection address** is especially important — without it, sites like Google can connect to polluted IPs and bypass the proxy even when domain rules are correct.

After toggling these on, refresh the subscription once more if routing still looks wrong.

## Usage tips

- **🌍 GLOBAL** — default route for general proxy traffic (`MATCH`, GFW, etc.).
- **Service groups** (AI, LinkedIn, Zoom, …) — switch each service independently.
- **⚡ AUTO** — url-test across all subscription nodes; good default for most groups.
- **Regional groups** (🇺🇸 US, 🇬🇧 UK, …) — only appear when your subscription has matching node names.

After editing the override script, save it and refresh the subscription again to pick up changes (or redeploy, if using the Vercel endpoint).

## Customization

Open [`archive/clash-rewrite.js`](archive/clash-rewrite.js) and adjust:

| Setting | Purpose |
|---------|---------|
| `RELAY_*` / `US-RELAY` | SOCKS5 relay for the AI group |
| `PROXY_SSH` | Block SSH (`22`) from going through the proxy |
| `SERVICE_DEFINITIONS` | Add or change per-service proxy groups |
| `REGION_DEFINITIONS` | Add or change regional node matching |

## Troubleshooting

- **Override error / red profile** — check the Clash Party log; the script throws if the subscription has no proxies.
- **Loop detected in ProxyGroup** — should not happen with the current script; refresh after updating to the latest version.
- **Service not proxying** — set that service’s group to **⚡ AUTO** or **🚀 NODES** in the proxy panel.
- **Google or other sites go DIRECT / don’t load in Chrome** — enable **DNS Override** and **Override connection address** in the sidebar (see step 4). In **Connections**, filter by the site name: traffic should hit the service group (e.g. **🔍 Google**), not **DIRECT** to a China IP. If proxied connections show 0 B download, try a different node in **🚀 NODES** (e.g. `trojan` or `hysteria2`).
- **Slack Huddles fail / no audio / can’t connect** — Huddles use Amazon Chime (`*.chime.aws`, UDP/3478). The override routes those to **💬 Slack**. In **Connections**, look for `chime.aws` or UDP to `99.77.*` — they should hit **💬 Slack**, not **DIRECT** or **🌍 GLOBAL**. Use a low-latency node with UDP support (e.g. US), or try **DIRECT** on the Slack group if Chime is reachable without a proxy. Slack recommends bypassing VPN for media when possible.
- **`[Provider] slack pull error: 400 Bad Request` (or other bm7 providers)** — caused by a double slash in the blackmatrix7 ruleset URL (`gh//blackmatrix7`). Fixed in current `clash-rewrite.js`. After updating the override, refresh the subscription; core logs should show successful provider loads instead of 400s. Note: Loyalsoldier’s reject list includes `+.slackb.com`, so a broken Slack ruleset can **REJECT** Slack traffic until domain fallbacks / a working ruleset match first.
