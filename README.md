# clash-config

A config generator that turns any subscription into a China-friendly config
with service-specific proxy groups (AI, LinkedIn, Zoom, Steam, etc.),
automatic regional node grouping, and rules from
[Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) and
[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script).

The primary interface is a **Vercel-hosted subscription endpoint**
([`api/subscribe.ts`](api/subscribe.ts)): point any Clash-compatible client
at the deployed URL and it gets the rewritten config directly. The original
[Clash Party](https://clashparty.org/) JS-override scripts still exist under
[`archive/`](archive/) — `api/subscribe.ts` runs them server-side, and
they're still pasteable as-is into Clash Party's JS override editor if you
prefer that workflow.

## Subscription service (Vercel)

`api/subscribe.ts` fetches your upstream subscription and applies
[`archive/clash-rewrite.js`](archive/clash-rewrite.js) (or
[`archive/ai-reroute-only.js`](archive/ai-reroute-only.js) via
`?variant=minimal`) server-side, so any Clash-compatible client — Clash
Party, Clash Verge, sing-box, anything that can subscribe to a URL — gets the
rewritten config directly, without needing JS-override support itself.

The HTTP layer is TypeScript; the rewrite logic itself stays plain JS in
`archive/`, unchanged, and the API route `require()`s it directly — one
implementation, not two to keep in sync.

**This does not fix two structural things:**
1. DNS Override / sniff override are still Clash Party sidebar toggles that
   gate whether *that app* applies the `dns`/`sniffer` sections regardless of
   where the YAML was generated.
2. QUIC-based protocols (hysteria2, tuic) still allocate the same
   per-connection buffers in whichever core ultimately runs them — moving
   the rewrite to a server doesn't change core runtime behavior.

What it does change: other clients can subscribe without an embedded JS
engine, and the transform runs in a normal Node environment instead of Clash
Party's sandboxed one.

### Deploy

1. `vercel link` (or `vercel deploy` the first time) from this directory.
2. Set environment variables (`vercel env add <NAME>` or via the dashboard) —
   see [`.env.example`](.env.example) for the full list:
   - `SUBSCRIPTION_URL` — your upstream subscription URL. Keep this
     server-side only; it's typically a credential.
   - `SUBSCRIBE_TOKEN` — a shared secret required as `?token=` on the
     endpoint, so the deployed URL can't be scraped for your relay
     credentials by anyone who finds it (`openssl rand -hex 24`).
3. `vercel deploy --prod`.
4. Subscribe your client to:
   `https://<your-project>.vercel.app/api/subscribe?token=<SUBSCRIBE_TOKEN>`
   - Add `&variant=minimal` to use `ai-reroute-only.js` instead of the full
     rewrite.

### Local development

```bash
npm install
npm run typecheck   # tsc --noEmit
vercel dev          # requires the Vercel CLI; reads .env.local
```

## Using the archived scripts directly in Clash Party

If you'd rather paste the override straight into Clash Party instead of
running the Vercel endpoint, the scripts in [`archive/`](archive/) still work
standalone.

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
