// Clash Party JavaScript override — https://clashparty.org/docs/guide/override/javascript
// Pattern reference: https://gist.github.com/yanyongyu/304738a70e69a49edaff6b06054fd91d
//
// Ruleset sources (verified active maintenance, daily CI):
//   - Loyalsoldier/clash-rules  — China IP/domain split, ads, GFW (release branch)
//   - blackmatrix7/ios_rule_script — app-specific rules (OpenAI, Microsoft, Steam, etc.)

const RELAY_IP = "38.15.20.176";
const RELAY_USERNAME = "nWtZDtDggAiw";
const RELAY_PASSWORD = "PYkyxvydYO";
const PROXY_SSH = false;

// Clash Party binds the tray / proxy UI to a group named GLOBAL.
const GROUP = {
	GLOBAL: "🌍 GLOBAL",
	SELECTION: "🎯 Selection",
	NODES: "🚀 NODES",
	AUTO: "⚡ AUTO",
	AI_ROUTE: "🛰 AI-ROUTE",
	AI_FALLBACK: "↩ AI-FALLBACK",
	AI: "🤖 AI",
	MICROSOFT: "Ⓜ️ Microsoft",
	STEAM: "🎮 Steam",
	GOOGLE: "🔍 Google",
	YOUTUBE: "▶️ YouTube",
	TELEGRAM: "✈️ Telegram",
	NETFLIX: "🎬 Netflix",
	SLACK: "💬 Slack",
	SOCIAL: "🐦 Social",
	LINKEDIN: "💼 LinkedIn",
	DEVELOPER: "👩‍💻 Developer",
	ZOOM: "📹 Zoom",
	US: "🇺🇸 US",
	UK: "🇬🇧 UK",
	DE: "🇩🇪 DE",
	FR: "🇫🇷 FR",
	IN: "🇮🇳 IN",
	JP: "🇯🇵 JP",
	KR: "🇰🇷 KR",
	SG: "🇸🇬 SG",
	HK: "🇭🇰 HK",
	TW: "🇹🇼 TW",
	AU: "🇦🇺 AU",
	CA: "🇨🇦 CA",
	NL: "🇳🇱 NL",
};

const MAIN_POLICY = GROUP.GLOBAL;

const LOYAL_BASE =
	"https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release";
const BM7_BASE =
	"https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash";

const relayProxy = {
	name: "US-RELAY",
	type: "socks5",
	server: RELAY_IP,
	port: 443,
	username: RELAY_USERNAME,
	password: RELAY_PASSWORD,
	"skip-cert-verify": true,
	"dialer-proxy": GROUP.AUTO,
};

const loyalsoldierProvider = (key, file, behavior = "domain") => ({
	[key]: {
		type: "http",
		behavior,
		url: `${LOYAL_BASE}/${file}.txt`,
		path: `./ruleset/loyal-${key}.yaml`,
		interval: 86400,
	},
});

const bm7Provider = (name) => ({
	[name.toLowerCase()]: {
		type: "http",
		format: "yaml",
		behavior: "classical",
		url: `${BM7_BASE}/${name}/${name}.yaml`,
		path: `./ruleset/bm7-${name.toLowerCase()}.yaml`,
		interval: 86400,
	},
});

const aiDomainSuffixes = [
	"cursor.sh",
	"perplexity.ai",
	"groq.com",
	"x.ai",
	"cloudflare.com",
	"cloudflareinsights.com",
	"onsleek.ai",
	"grok.com",
	"grokipedia.com",
	"grokusercontent.com",
	"agilebits.com",
	"outlier.ai",
	"hcaptcha.com",
	"stripe.com",
	"stripecdn.com",
	"facebook.net",
	"stripe.network",
	"arc.net",
	"claude.com",
	"mintlify.com",
];

const devDomainSuffixes = ["supabase.co", "plannotator.ai"];

const directDomainSuffixes = [
	"bytedance.net",
	"byted.org",
	"zijieapi.com",
];

// Service groups default to SELECTION; change SELECTION once to steer all of them.
const SERVICE_DEFINITIONS = [
	{
		group: GROUP.AI,
		defaultMember: GROUP.SELECTION,
		alternateMembers: [GROUP.AI_ROUTE],
		ruleSets: ["openai", "claude", "gemini"],
		domainSuffixes: aiDomainSuffixes,
	},
	{
		group: GROUP.MICROSOFT,
		defaultMember: GROUP.SELECTION,
		ruleSets: ["microsoft"],
	},
	{
		group: GROUP.STEAM,
		defaultMember: GROUP.SELECTION,
		alternateMembers: ["DIRECT"],
		ruleSets: ["steam"],
		directRuleSets: ["steamcn"],
		geositeDirect: ["steam@cn"],
	},
	{
		group: GROUP.GOOGLE,
		defaultMember: GROUP.SELECTION,
		proxyOnly: true,
		domainSuffixes: [
			"google.com",
			"googleapis.com",
			"gstatic.com",
			"googlevideo.com",
			"googleusercontent.com",
			"ggpht.com",
			"gvt1.com",
			"gvt2.com",
			"1e100.net",
		],
		ruleSets: ["google"],
	},
	{
		group: GROUP.YOUTUBE,
		defaultMember: GROUP.SELECTION,
		ruleSets: ["youtube"],
	},
	{
		group: GROUP.TELEGRAM,
		defaultMember: GROUP.SELECTION,
		ruleSets: ["telegram"],
	},
	{
		group: GROUP.NETFLIX,
		defaultMember: GROUP.SELECTION,
		ruleSets: ["netflix"],
	},
	{
		group: GROUP.SLACK,
		defaultMember: GROUP.SELECTION,
		ruleSets: ["slack"],
	},
	{
		group: GROUP.SOCIAL,
		defaultMember: GROUP.SELECTION,
		ruleSets: ["twitter"],
	},
	{
		group: GROUP.LINKEDIN,
		defaultMember: GROUP.SELECTION,
		proxyOnly: true,
		processNames: ["LinkedIn"],
		domainSuffixes: [
			"linkedin.com",
			"linkedin.cn",
			"lnkd.in",
			"licdn.com",
			"licdn.cn",
			"bizographics.com",
		],
		ruleSets: ["linkedin"],
	},
	{
		group: GROUP.DEVELOPER,
		defaultMember: GROUP.SELECTION,
		domainSuffixes: devDomainSuffixes,
	},
	{
		group: GROUP.ZOOM,
		defaultMember: GROUP.SELECTION,
		alternateMembers: ["DIRECT"],
		domainSuffixes: [
			"zoom.us",
			"zoomgov.us",
			"zoom.com",
			"zoom.cn",
			"zpns.zoom.us",
			"cloud.zoom.us",
		],
	},
];

// Airport marketing / info entries are not real nodes.
const EXCLUDED_NODE_PATTERN =
	/剩余|到期|主页|官网|订阅|流量|重置|续费|拒绝|RELAY|relay/i;

function countryToken(code) {
	return `(?:^|[\\s\\[(_\\-|])${code}(?:[\\s\\])_\\-|]|$|\\d)`;
}

function regionPattern(...parts) {
	return new RegExp(parts.join("|"), "i");
}

const REGION_DEFINITIONS = [
	{
		name: GROUP.US,
		pattern: regionPattern(
			"美国|美國|United\\s*States|洛杉矶|旧金山|西雅图|纽约|芝加哥|硅谷|凤凰城|达拉斯|华盛顿|美西|美东|🇺🇸",
			countryToken("US"),
		),
	},
	{
		name: GROUP.UK,
		pattern: regionPattern(
			"英国|英國|United\\s*Kingdom|London|伦敦|🇬🇧",
			countryToken("UK"),
		),
	},
	{
		name: GROUP.DE,
		pattern: regionPattern(
			"德国|德國|Germany|Frankfurt|Berlin|柏林|法兰克福|慕尼黑|🇩🇪",
			countryToken("DE"),
		),
	},
	{
		name: GROUP.FR,
		pattern: regionPattern(
			"法国|法國|France|Paris|巴黎|马赛|🇫🇷",
			countryToken("FR"),
		),
	},
	{
		name: GROUP.IN,
		pattern: regionPattern(
			"印度|India|Mumbai|Delhi|孟买|德里|班加罗尔|🇮🇳",
			countryToken("IN"),
		),
	},
	{
		name: GROUP.JP,
		pattern: regionPattern(
			"日本|Japan|东京|東京|大阪|名古屋|🇯🇵",
			countryToken("JP"),
		),
	},
	{
		name: GROUP.KR,
		pattern: regionPattern(
			"韩国|韓國|南韩|南韓|Korea|Seoul|首尔|首爾|🇰🇷",
			countryToken("KR"),
		),
	},
	{
		name: GROUP.SG,
		pattern: regionPattern("新加坡|Singapore|狮城|🇸🇬", countryToken("SG")),
	},
	{
		name: GROUP.HK,
		pattern: regionPattern("香港|Hong\\s*Kong|🇭🇰", countryToken("HK")),
	},
	{
		name: GROUP.TW,
		pattern: regionPattern("台湾|台灣|Taiwan|🇹🇼", countryToken("TW")),
	},
	{
		name: GROUP.AU,
		pattern: regionPattern(
			"澳大利亚|澳洲|Australia|Sydney|Melbourne|悉尼|墨尔本|🇦🇺",
			countryToken("AU"),
		),
	},
	{
		name: GROUP.CA,
		pattern: regionPattern(
			"加拿大|Canada|Toronto|Vancouver|蒙特利尔|多伦多|温哥华|🇨🇦",
			countryToken("CA"),
		),
	},
	{
		name: GROUP.NL,
		pattern: regionPattern(
			"荷兰|Netherlands|Amsterdam|阿姆斯特丹|🇳🇱",
			countryToken("NL"),
		),
	},
];

const ruleProviders = {
	...loyalsoldierProvider("reject", "reject"),
	...loyalsoldierProvider("direct", "direct"),
	...loyalsoldierProvider("private", "private"),
	...loyalsoldierProvider("icloud", "icloud"),
	...loyalsoldierProvider("apple", "apple"),
	...loyalsoldierProvider("proxy", "proxy"),
	...loyalsoldierProvider("gfw", "gfw"),
	...loyalsoldierProvider("cncidr", "cncidr", "ipcidr"),
	...loyalsoldierProvider("lancidr", "lancidr", "ipcidr"),
	...loyalsoldierProvider("telegramcidr", "telegramcidr", "ipcidr"),
	...loyalsoldierProvider("applications", "applications", "classical"),
	...bm7Provider("OpenAI"),
	...bm7Provider("Claude"),
	...bm7Provider("Gemini"),
	...bm7Provider("Microsoft"),
	...bm7Provider("Steam"),
	...bm7Provider("SteamCN"),
	...bm7Provider("Google"),
	...bm7Provider("YouTube"),
	...bm7Provider("Telegram"),
	...bm7Provider("Netflix"),
	...bm7Provider("Slack"),
	...bm7Provider("Twitter"),
	...bm7Provider("LinkedIn"),
};

const GROUP_TYPES_WITH_MEMBERS = new Set([
	"select",
	"url-test",
	"fallback",
	"load-balance",
	"relay",
]);

function uniqueList(items) {
	return [...new Set(items)];
}

function isPolicyName(name, groupNames) {
	return name === "DIRECT" || name === "REJECT" || groupNames.has(name);
}

function extractProxyNamesFromGroups(groups) {
	const groupNames = new Set(groups.map((group) => group.name));
	const names = new Set();

	for (const group of groups) {
		for (const entry of group.proxies || []) {
			if (!isPolicyName(entry, groupNames)) {
				names.add(entry);
			}
		}
	}

	return [...names];
}

function discoverNodePool(config) {
	const proxyNames = (config.proxies || [])
		.map((proxy) => proxy.name)
		.filter((name) => name !== relayProxy.name);

	if (proxyNames.length > 0) {
		return { mode: "proxies", members: proxyNames };
	}

	const providerNames = Object.keys(config["proxy-providers"] || {});
	if (providerNames.length > 0) {
		return { mode: "providers", members: providerNames };
	}

	const fromGroups = extractProxyNamesFromGroups(config["proxy-groups"] || []);
	if (fromGroups.length > 0) {
		return { mode: "proxies", members: fromGroups };
	}

	return { mode: "proxies", members: [] };
}

function memberField(nodePool) {
	return nodePool.mode === "providers"
		? { use: nodePool.members }
		: { proxies: nodePool.members };
}

function getSubscriptionNodeNames(nodePool) {
	if (nodePool.mode !== "proxies") {
		return [];
	}

	return nodePool.members.filter(
		(name) =>
			name !== relayProxy.name && !EXCLUDED_NODE_PATTERN.test(name),
	);
}

function matchProxiesByRegion(names, pattern) {
	return names.filter((name) => pattern.test(name));
}

// Only regions with at least one matching subscription node are returned.
function buildActiveRegionalGroups(nodePool) {
	const nodeNames = getSubscriptionNodeNames(nodePool);
	if (nodeNames.length === 0) {
		return [];
	}

	return REGION_DEFINITIONS.map(({ name, pattern }) => ({
		name,
		proxies: matchProxiesByRegion(nodeNames, pattern),
	})).filter(({ proxies }) => proxies.length > 0);
}

function buildSelectionMembers(regionalNames) {
	return uniqueList([GROUP.AUTO, GROUP.NODES, "DIRECT", ...regionalNames]);
}

function buildServiceGroup(service) {
	const {
		group,
		defaultMember = GROUP.SELECTION,
		proxyOnly = false,
		alternateMembers = [],
	} = service;

	return {
		name: group,
		type: "select",
		proxies: uniqueList([
			defaultMember,
			...(defaultMember !== GROUP.SELECTION ? [GROUP.SELECTION] : []),
			...alternateMembers.filter(
				(member) => member !== defaultMember && member !== GROUP.SELECTION,
			),
			...(proxyOnly ? [] : ["DIRECT"]),
		]),
	};
}

function buildProxyGroups(nodePool) {
	const regionalGroups = buildActiveRegionalGroups(nodePool);
	const regionalNames = regionalGroups.map(({ name }) => name);
	const selectionMembers = buildSelectionMembers(regionalNames);
	const aiFallbackMembers =
		regionalNames.length > 0 ? regionalNames : [GROUP.SELECTION];

	const groups = [
		{
			name: MAIN_POLICY,
			type: "select",
			proxies: [GROUP.SELECTION],
		},
		{
			name: GROUP.SELECTION,
			type: "select",
			proxies: selectionMembers,
		},
		{
			name: GROUP.NODES,
			type: "select",
			...memberField(nodePool),
		},
		...SERVICE_DEFINITIONS.map((service) => buildServiceGroup(service)),
		{
			name: GROUP.AUTO,
			type: "url-test",
			...memberField(nodePool),
			url: "http://www.gstatic.com/generate_204",
			interval: 300,
			tolerance: 50,
			hidden: true,
		},
		{
			name: GROUP.AI_FALLBACK,
			type: "url-test",
			proxies: aiFallbackMembers,
			url: "https://api.openai.com/",
			interval: 300,
			tolerance: 50,
			hidden: true,
		},
		{
			name: GROUP.AI_ROUTE,
			type: "fallback",
			proxies: ["US-RELAY", GROUP.AI_FALLBACK],
			url: "https://api.openai.com/",
			interval: 300,
			hidden: true,
		},
	];

	for (const { name, proxies } of regionalGroups) {
		groups.push({
			name,
			type: "url-test",
			proxies,
			url: "http://www.gstatic.com/generate_204",
			interval: 300,
			tolerance: 50,
			hidden: true,
		});
	}

	return groups;
}

function validateProxyGroups(groups) {
	for (const [index, group] of groups.entries()) {
		if (!GROUP_TYPES_WITH_MEMBERS.has(group.type)) {
			continue;
		}

		const members = group.proxies || group.use;
		if (!members || members.length === 0) {
			throw new Error(
				`proxy group[${index}] ${group.name}: \`use\` or \`proxies\` missing`,
			);
		}
	}
}

function buildRules() {
	const rules = [];

	if (!PROXY_SSH) {
		rules.push("PROCESS-NAME,ssh,DIRECT", "DST-PORT,22,DIRECT");
	}

	for (const service of SERVICE_DEFINITIONS) {
		for (const process of service.processNames || []) {
			rules.push(`PROCESS-NAME,${process},${service.group}`);
		}
		for (const suffix of service.directDomainSuffixes || []) {
			rules.push(`DOMAIN-SUFFIX,${suffix},DIRECT`);
		}
		for (const suffix of service.domainSuffixes || []) {
			rules.push(`DOMAIN-SUFFIX,${suffix},${service.group}`);
		}
		for (const geosite of service.geositeDirect || []) {
			rules.push(`GEOSITE,${geosite},DIRECT`);
		}
		for (const ruleSet of service.directRuleSets || []) {
			rules.push(`RULE-SET,${ruleSet},DIRECT`);
		}
		for (const ruleSet of service.ruleSets || []) {
			rules.push(`RULE-SET,${ruleSet},${service.group}`);
		}
	}

	for (const suffix of directDomainSuffixes) {
		rules.push(`DOMAIN-SUFFIX,${suffix},DIRECT`);
	}

	rules.push(
		"RULE-SET,applications,DIRECT",
		"RULE-SET,private,DIRECT",
		"RULE-SET,reject,REJECT",
		"RULE-SET,icloud,DIRECT",
		"RULE-SET,apple,DIRECT",
		`RULE-SET,proxy,${MAIN_POLICY}`,
		`RULE-SET,gfw,${MAIN_POLICY}`,
		"RULE-SET,direct,DIRECT",
		"RULE-SET,lancidr,DIRECT,no-resolve",
		"RULE-SET,cncidr,DIRECT,no-resolve",
		`RULE-SET,telegramcidr,${GROUP.TELEGRAM},no-resolve`,
		"GEOIP,LAN,DIRECT,no-resolve",
		"GEOIP,CN,DIRECT,no-resolve",
		`MATCH,${MAIN_POLICY}`,
	);

	return rules;
}

function ensureRelayProxy(config) {
	const proxies = config.proxies || [];
	if (proxies.some((proxy) => proxy.name === relayProxy.name)) {
		return;
	}
	config.proxies = [...proxies, relayProxy];
}

function ensureRuntimeDefaults(config) {
	config.mode = "rule";

	if (!config.profile) {
		config.profile = {};
	}
	config.profile["store-selected"] = true;

	if (config.dns) {
		return;
	}

	config.dns = {
		enable: true,
		ipv6: false,
		"enhanced-mode": "fake-ip",
		nameserver: ["https://doh.pub/dns-query", "https://dns.alidns.com/dns-query"],
		fallback: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
		"fallback-filter": { geoip: true, "geoip-code": "CN" },
	};
}

function main(config) {
	const proxyCount = config?.proxies?.length ?? 0;
	const proxyProviderCount = Object.keys(config?.["proxy-providers"] ?? {}).length;

	if (proxyCount === 0 && proxyProviderCount === 0) {
		throw new Error("No proxies or proxy-providers found in subscription");
	}

	const nodePool = discoverNodePool(config);
	if (nodePool.members.length === 0) {
		throw new Error("Could not discover any nodes or proxy-providers");
	}

	const proxyGroups = buildProxyGroups(nodePool);
	validateProxyGroups(proxyGroups);

	ensureRelayProxy(config);
	ensureRuntimeDefaults(config);

	config["proxy-groups"] = proxyGroups;
	config["rule-providers"] = {
		...(config["rule-providers"] || {}),
		...ruleProviders,
	};
	config.rules = buildRules();

	return config;
}
