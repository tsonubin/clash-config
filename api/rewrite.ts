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
	GLOBAL: "🌍 GLOBAL",
	AUTO: "⚡ AUTO",
	AI: "🤖 AI",
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

const HEALTHCHECK_URL = "http://www.gstatic.com/generate_204";

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

interface ServiceDef {
	group: string;
	/** Members listed before the shared tail; first entry becomes the default. */
	head?: string[];
	ruleSets?: string[];
	suffixes?: string[];
	ipCidrs?: string[];
}

const SERVICES: ServiceDef[] = [
	{ group: GROUP.AI, ruleSets: ["openai", "claude", "gemini"], suffixes: AI_SUFFIXES },
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

function buildProxyGroups(nodes: string[]): ProxyGroup[] {
	// Shared tail: every service group can reach AUTO, GLOBAL, each individual
	// node, or DIRECT — so any service can be steered without editing others.
	const tail = [GROUP.AUTO, GROUP.GLOBAL, ...nodes, "DIRECT"];

	const groups: ProxyGroup[] = [
		{
			name: GROUP.GLOBAL,
			type: "select",
			proxies: [GROUP.AUTO, ...nodes, "DIRECT"],
		},
		{
			name: GROUP.AUTO,
			type: "url-test",
			proxies: nodes,
			url: HEALTHCHECK_URL,
			interval: 300,
			tolerance: 50,
			lazy: false,
		},
	];

	for (const service of SERVICES) {
		const head = service.head ?? [];
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
	// Remote-DNS-first, and deliberately not China-first.
	//
	// The previous design used domestic resolvers as primary with a
	// fallback + fallback-filter geoip-CN split. That only resolved correctly on
	// a mainland network; anywhere else the primaries were unreachable and every
	// lookup hard-failed ("couldn't find ip") rather than degrading. Encrypted
	// foreign resolvers answer from both sides, so they are the default and
	// China traffic is kept direct by *rules*, not by DNS.
	const remote = ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"];

	config.dns = {
		enable: true,
		ipv6: false,
		"enhanced-mode": "fake-ip",
		"fake-ip-range": "198.18.0.1/16",
		// Plain IPs only — these bootstrap the DoH hostnames above, so a DoH URL
		// here would be circular.
		"default-nameserver": ["1.1.1.1", "8.8.8.8"],
		nameserver: remote,
		// Resolves the node's own hostname; without it the client would try to
		// dial a fake-ip address for the server it is connecting to.
		"proxy-server-nameserver": remote,
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
	const nodes = proxyNames(config);
	if (nodes.length === 0) {
		throw new Error("No proxies found in upstream subscription");
	}

	config.mode = "rule";
	config["mixed-port"] = 7890;
	config["allow-lan"] = false;
	config["log-level"] = "info";
	config["external-controller"] = "127.0.0.1:9090";
	config.profile = { "store-selected": true, "store-fake-ip": true };

	config["proxy-groups"] = buildProxyGroups(nodes);
	config["rule-providers"] = buildRuleProviders();
	config.rules = buildRules();

	applyDns(config);
	applySniffer(config);

	return config;
}
