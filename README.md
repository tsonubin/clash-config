# clash-config

A [Clash Party](https://clashparty.org/) JavaScript override that turns any subscription into a China-friendly config with service-specific proxy groups (AI, LinkedIn, Zoom, Steam, etc.), automatic regional node grouping, and rules from [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) and [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script).

The entry script is [`clash-rewrite.js`](clash-rewrite.js).

## Prerequisites

- [Clash Party](https://clashparty.org/) installed
- A subscription URL (any provider — the script discovers nodes automatically)
- Optional: edit the `US-RELAY` block at the top of `clash-rewrite.js` if you use the AI relay

## Setup in Clash Party

### 1. Create the override

1. Open **Clash Party**.
2. Go to the **Override** section (override block in the sidebar).
3. Create a new **JavaScript** override.
4. Paste the contents of [`clash-rewrite.js`](clash-rewrite.js) into the editor.
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

After editing the override script, save it and refresh the subscription again to pick up changes.

## Customization

Open [`clash-rewrite.js`](clash-rewrite.js) and adjust:

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
