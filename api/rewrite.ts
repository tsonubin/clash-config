// Config generation for the subscription endpoint.
//
// Written against the current topology: one server exposing several protocols
// (Reality / Hysteria2 / AnyTLS / SS2022), not a multi-region airport. There is
// therefore no region-group or node-discovery logic — every node is a peer and
// selection is about which *protocol* performs best, not which country to exit.
//
// Hard requirement: the emitted config must work as-is in any Clash-compatible
// client (Stash, mihomo, Verge) with no app-level DNS or sniffing toggles.

export type ClashConfig = Record<string, unknown>;

interface Proxy {
	name: string;
	[key: string]: unknown;
}

interface ProxyGroup {
	name: string;
	type: string;
	proxies: string[];
	url?: string;
	interval?: number;
	tolerance?: number;
	timeout?: number;
	lazy?: boolean;
}

interface RuleProvider {
	type: string;
	behavior: string;
	format: string;
	url: string;
	path: string;
	interval: number;
}

export const GROUP = {
	MANUAL: "🚀 MANUAL",
	GLOBAL: "🌍 GLOBAL",
	AUTO: "⚡ AUTO",
	AI: "🤖 AI",
	AI_ROUTE: "🛰 AI-ROUTE",
	AI_FALLBACK: "↩ AI-FALLBACK",
	STEAM: "🎮 Steam",
	GOOGLE: "🔍 Google",
	YOUTUBE: "▶️ YouTube",
	SOCIAL: "🐦 Social",
	TELEGRAM: "✈️ Telegram",
	NETFLIX: "🎬 Netflix",
	SLACK: "💬 Slack",
	MICROSOFT: "Ⓜ️ Microsoft",
	APPLE: "🍎 Apple",
	DEVELOPER: "👩‍💻 Developer",
	DIRECT: "🎯 DIRECT",
	FINAL: "🐟 FINAL",
} as const;

// cdn.jsdelivr.net is unreliable from mainland networks; jsdmirror fronts the
// same GitHub content. Single slash after `gh` — `gh//owner` 400s.
const CDN = "https://cdn.jsdmirror.com/gh";
const LOYAL = `${CDN}/Loyalsoldier/clash-rules@release`;
const BM7 = `${CDN}/blackmatrix7/ios_rule_script@master/rule/Clash`;

const HEALTHCHECK_URL = "https://www.gstatic.com/generate_204";

// This deployment serves straw. Keep its bootstrap independent of local DNS;
// update these public addresses if the server moves. TLS names remain unchanged.
const SERVER_HOSTS: Record<string, string> = {
	"s.tsonubin.com": "192.243.126.66",
	"sub.tsonubin.com": "192.243.126.66",
};

export const RELAY_NAME = "US-RELAY";

// Upstream SOCKS5 relay used to give AI services a stable US egress. Read from
// the environment rather than hardcoded, since the emitted config carries these
// credentials in plaintext to every client. When unset, the relay is omitted
// entirely and AI traffic simply uses the normal nodes.
function buildRelayProxy(): Proxy | null {
	const server = process.env.RELAY_HOST;
	const username = process.env.RELAY_USERNAME;
	const password = process.env.RELAY_PASSWORD;
	if (!server || !username || !password) return null;

	const port = Number(process.env.RELAY_PORT ?? 443);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid RELAY_PORT: ${process.env.RELAY_PORT}`);
	}

	return {
		name: RELAY_NAME,
		type: "socks5",
		server,
		port,
		username,
		password,
		"skip-cert-verify": true,
		// Reach the relay *through* our own nodes rather than from the client's
		// raw network. AUTO never contains the relay itself, so this cannot loop.
		"dialer-proxy": GROUP.AUTO,
	};
}

function loyalProvider(key: string, file: string, behavior: string): RuleProvider {
	return {
		type: "http",
		behavior,
		format: "yaml",
		url: `${LOYAL}/${file}.txt`,
		path: `./ruleset/loyal-${key}.yaml`,
		interval: 86400,
	};
}

function bm7Provider(name: string): RuleProvider {
	return {
		type: "http",
		behavior: "classical",
		format: "yaml",
		url: `${BM7}/${name}/${name}.yaml`,
		path: `./ruleset/bm7-${name.toLowerCase()}.yaml`,
		interval: 86400,
	};
}

function buildRuleProviders(): Record<string, RuleProvider> {
	return {
		reject: loyalProvider("reject", "reject", "domain"),
		cncidr: loyalProvider("cncidr", "cncidr", "ipcidr"),
		direct: loyalProvider("direct", "direct", "domain"),
		private: loyalProvider("private", "private", "domain"),
		openai: bm7Provider("OpenAI"),
		claude: bm7Provider("Claude"),
		gemini: bm7Provider("Gemini"),
		steam: bm7Provider("Steam"),
		steamcn: bm7Provider("SteamCN"),
		google: bm7Provider("Google"),
		youtube: bm7Provider("YouTube"),
		twitter: bm7Provider("Twitter"),
		telegram: bm7Provider("Telegram"),
		netflix: bm7Provider("Netflix"),
		slack: bm7Provider("Slack"),
		microsoft: bm7Provider("Microsoft"),
		apple: bm7Provider("Apple"),
		github: bm7Provider("GitHub"),
	};
}

// Domains worth pinning directly, either because the ruleset misses them or
// because a broader reject list would otherwise swallow them.
const AI_SUFFIXES = [
	"claude.com",
	"claude.ai",
	"anthropic.com",
	"openai.com",
	"chatgpt.com",
	"x.ai",
	"grok.com",
	"perplexity.ai",
	"cursor.sh",
	"groq.com",
];

// Huddles media rides Amazon Chime, which blackmatrix7's Slack ruleset omits.
// Without these, audio/video falls through to FINAL and typically fails.
const SLACK_SUFFIXES = [
	"slack.com",
	"slack-edge.com",
	"slack-files.com",
	"slack-msgs.com",
	"slack-imgs.com",
	"slack-redir.net",
	"slackb.com",
	"chime.aws",
];
const SLACK_IP_CIDRS = ["99.77.128.0/18"];

const DEVELOPER_SUFFIXES = ["supabase.co", "vercel.app", "vercel.com"];

// Steam client login/CM and community traffic need proxying so login, friends/chat,
// store webviews, and community features work reliably from mainland networks.
const STEAM_CLIENT_SUFFIXES = [
	"cm.steampowered.com",
	"steamcommunity.com",
	"steam-chat.com",
];

// Game downloads / content delivery networks (CDNs) must go direct to maximize
// throughput and avoid burning proxy bandwidth.
const STEAM_DOWNLOAD_SUFFIXES = [
	"steamcontent.com",
	"steamserver.net",
	"steampipe.akamaized.net",
	"steampipe-kr.akamaized.net",
	"steampipe-partner.akamaized.net",
	"steamcdn-a.akamaihd.net",
	"steamchina.com",
];

interface ServiceDef {
	group: string;
	/** Members listed before the shared tail; first entry becomes the default. */
	head?: string[];
	ruleSets?: string[];
	suffixes?: string[];
	directSuffixes?: string[];
	directRuleSets?: string[];
	ipCidrs?: string[];
}

const SERVICES: ServiceDef[] = [
	{ group: GROUP.AI, ruleSets: ["openai", "claude", "gemini"], suffixes: AI_SUFFIXES },
	{
		group: GROUP.STEAM,
		suffixes: STEAM_CLIENT_SUFFIXES,
		directSuffixes: STEAM_DOWNLOAD_SUFFIXES,
		directRuleSets: ["steamcn"],
		ruleSets: ["steam"],
	},
	{ group: GROUP.GOOGLE, ruleSets: ["google"] },
	{ group: GROUP.YOUTUBE, ruleSets: ["youtube"] },
	{ group: GROUP.SOCIAL, ruleSets: ["twitter"] },
	{ group: GROUP.TELEGRAM, ruleSets: ["telegram"] },
	{ group: GROUP.NETFLIX, ruleSets: ["netflix"] },
	{
		group: GROUP.SLACK,
		ruleSets: ["slack"],
		suffixes: SLACK_SUFFIXES,
		ipCidrs: SLACK_IP_CIDRS,
	},
	{ group: GROUP.MICROSOFT, ruleSets: ["microsoft"] },
	// Apple services are generally faster direct; proxying breaks some CDN routing.
	{ group: GROUP.APPLE, head: ["DIRECT"], ruleSets: ["apple"] },
	{ group: GROUP.DEVELOPER, ruleSets: ["github"], suffixes: DEVELOPER_SUFFIXES },
];

function proxyNames(config: ClashConfig): string[] {
	const proxies = Array.isArray(config.proxies) ? (config.proxies as Proxy[]) : [];
	return proxies
		.map((p) => p?.name)
		.filter((name): name is string => typeof name === "string" && name.length > 0);
}

function buildProxyGroups(nodes: string[], automaticNodes: string[], hasRelay: boolean): ProxyGroup[] {
	// Shared tail: every service group can reach AUTO, GLOBAL, each individual
	// node, or DIRECT — so any service can be steered without editing others.
	const tail = [GROUP.AUTO, GROUP.MANUAL, GROUP.GLOBAL, ...nodes, "DIRECT"];

	const groups: ProxyGroup[] = [
		{ name: GROUP.MANUAL, type: "select", proxies: nodes },
		{
			name: GROUP.GLOBAL,
			type: "select",
			proxies: [GROUP.AUTO, GROUP.MANUAL, ...nodes, "DIRECT"],
		},
		{
			name: GROUP.AUTO,
			type: "fallback",
			proxies: automaticNodes,
			url: HEALTHCHECK_URL,
			interval: 60,
			timeout: 5000,
			lazy: false,
		},
	];

	if (hasRelay) {
		groups.push(
			{
				// Relay first; if it stops answering the healthcheck, traffic moves
				// to the plain nodes instead of black-holing.
				name: GROUP.AI_ROUTE,
				type: "fallback",
				proxies: [RELAY_NAME, GROUP.AI_FALLBACK],
				url: HEALTHCHECK_URL,
				interval: 60,
				lazy: false,
			},
			{
				name: GROUP.AI_FALLBACK,
				type: "fallback",
				proxies: automaticNodes,
				url: HEALTHCHECK_URL,
				interval: 60,
				timeout: 5000,
				lazy: false,
			},
		);
	}

	for (const service of SERVICES) {
		// The AI group leads with the relay route when one is configured.
		const head =
			service.group === GROUP.AI && hasRelay
				? [GROUP.AI_ROUTE, ...(service.head ?? [])]
				: (service.head ?? []);
		groups.push({
			name: service.group,
			type: "select",
			proxies: dedupe([...head, ...tail]),
		});
	}

	groups.push(
		{ name: GROUP.DIRECT, type: "select", proxies: ["DIRECT", GROUP.GLOBAL] },
		{ name: GROUP.FINAL, type: "select", proxies: [GROUP.GLOBAL, GROUP.AUTO, "DIRECT"] },
	);

	return groups;
}

function buildRules(): string[] {
	const rules: string[] = [];

	// Order matters: private/LAN first, then explicit service matches, then the
	// broad China-direct sets, then FINAL. Ads are rejected before services so a
	// tracker on a proxied domain still dies.
	rules.push(
		"RULE-SET,private,DIRECT",
		"DOMAIN-SUFFIX,local,DIRECT",
		"IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
		"IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
		"IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
		"IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
	);

	rules.push("RULE-SET,reject,REJECT");

	for (const service of SERVICES) {
		for (const suffix of service.suffixes ?? []) {
			rules.push(`DOMAIN-SUFFIX,${suffix},${service.group}`);
		}
		for (const suffix of service.directSuffixes ?? []) {
			rules.push(`DOMAIN-SUFFIX,${suffix},DIRECT`);
		}
		for (const set of service.directRuleSets ?? []) {
			rules.push(`RULE-SET,${set},DIRECT`);
		}
		for (const cidr of service.ipCidrs ?? []) {
			rules.push(`IP-CIDR,${cidr},${service.group},no-resolve`);
		}
		for (const set of service.ruleSets ?? []) {
			rules.push(`RULE-SET,${set},${service.group}`);
		}
	}

	rules.push(
		"RULE-SET,direct,DIRECT",
		"RULE-SET,cncidr,DIRECT,no-resolve",
		"GEOIP,CN,DIRECT",
		`MATCH,${GROUP.FINAL}`,
	);

	return rules;
}

function applyDns(config: ClashConfig): void {
	// Foreign DoH must travel through a working proxy on mainland networks.
	// Proxy endpoints are pinned above, so resolving the proxy itself cannot
	// recursively depend on the proxy. Other upstream hosts use direct bootstrap.
	const remote = [
		`https://1.1.1.1/dns-query#${GROUP.AUTO}`,
		`https://8.8.8.8/dns-query#${GROUP.AUTO}`,
	];

	config.dns = {
		enable: true,
		ipv6: false,
		"enhanced-mode": "fake-ip",
		"fake-ip-range": "198.18.0.1/16",
		"default-nameserver": ["223.5.5.5", "119.29.29.29"],
		nameserver: remote,
		"proxy-server-nameserver": ["223.5.5.5", "119.29.29.29"],
		"direct-nameserver": ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
		"use-hosts": true,

		"fake-ip-filter": [
			"*.lan",
			"*.local",
			"localhost",
			"time.*.com",
			"ntp.*.com",
			"*.stun.*",
		],
	};
}

function applySniffer(config: ClashConfig): void {
	// With fake-ip, rules can only match domains if the real hostname is
	// recovered from the connection — that is what override-destination and
	// force-dns-mapping do. Assigned wholesale (not merged) so an upstream
	// `override-destination: false` cannot silently break domain routing.
	config.sniffer = {
		enable: true,
		"parse-pure-ip": true,
		"override-destination": true,
		"force-dns-mapping": true,
		sniff: {
			HTTP: { ports: [80, "8080-8880"] },
			TLS: { ports: [443, 8443] },
			QUIC: { ports: [443] },
		},
	};
}

function dedupe(items: string[]): string[] {
	return [...new Set(items)];
}

export function rewrite(config: ClashConfig): ClashConfig {
	// Computed before the relay is appended, so the relay never becomes a member
	// of AUTO — which its own dialer-proxy points at.
	const upstream = Array.isArray(config.proxies) ? (config.proxies as Proxy[]) : [];
	const rank: Record<string, number> = { hysteria2: 0, ss: 1, vless: 2, anytls: 3 };
	const ordered = upstream.filter((p) => p?.name !== RELAY_NAME).sort(
		(a, b) => (rank[String(a.type)] ?? 2) - (rank[String(b.type)] ?? 2),
	);
	config.proxies = ordered.map((p) => {
		const ip = SERVER_HOSTS[String(p.server)];
		return ip ? { ...p, server: ip } : p;
	});
	config.hosts = { ...(config.hosts as Record<string, unknown> ?? {}), ...SERVER_HOSTS };
	const nodes = proxyNames(config);
	// AnyTLS showed repeated TLS resets on this route; retain it for explicit
	// manual use, but do not allow automatic selection to pick it.
	const automaticNodes = ordered.filter((p) => p.type !== "anytls").map((p) => p.name);
	if (automaticNodes.length === 0) automaticNodes.push(...nodes);
	if (nodes.length === 0) {
		throw new Error("No proxies found in upstream subscription");
	}

	const relay = buildRelayProxy();
	if (relay) {
		const existing = Array.isArray(config.proxies) ? (config.proxies as Proxy[]) : [];
		config.proxies = [
			...existing.filter((p) => p?.name !== RELAY_NAME),
			relay,
		];
	}

	config.mode = "rule";
	config["mixed-port"] = 7890;
	config["allow-lan"] = false;
	config["log-level"] = "info";
	config["external-controller"] = "127.0.0.1:9090";
	config.profile = { "store-selected": true, "store-fake-ip": true };

	config["proxy-groups"] = buildProxyGroups(nodes, automaticNodes, relay !== null);
	config["rule-providers"] = buildRuleProviders();
	config.rules = buildRules();

	applyDns(config);
	applySniffer(config);

	return config;
}
