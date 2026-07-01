// Minimal Clash Party JavaScript override for AI rerouting only.
// It preserves the subscription's original proxy groups, DNS, sniffer, and rules.

const RELAY_IP = "38.15.20.176";
const RELAY_USERNAME = "nWtZDtDggAiw";
const RELAY_PASSWORD = "PYkyxvydYO";

const GROUP = {
	AI: "🤖 AI",
	AI_ROUTE: "🛰 AI-ROUTE",
};

const RELAY_PROXY_NAME = "US-RELAY";
const RULESET_CDN = "https://cdn.jsdmirror.com/gh";
const BM7_BASE = `${RULESET_CDN}/blackmatrix7/ios_rule_script@master/rule/Clash`;

const SMART_GROUP_CANDIDATES = [
	"Auto",
	"⚡ AUTO",
	"Proxy",
	"GLOBAL",
	"🌍 GLOBAL",
	"🎯 Selection",
	"🚀 NODES",
];

const aiDomainSuffixes = [
	"agilebits.com",
	"arc.net",
	"claude.com",
	"cloudflare.com",
	"cloudflareinsights.com",
	"cursor.sh",
	"facebook.net",
	"groq.com",
	"grok.com",
	"grokipedia.com",
	"grokusercontent.com",
	"hcaptcha.com",
	"mintlify.com",
	"onsleek.ai",
	"outlier.ai",
	"perplexity.ai",
	"stripe.com",
	"stripecdn.com",
	"stripe.network",
	"x.ai",
];

function bm7Provider(name) {
	return {
		[name.toLowerCase()]: {
			type: "http",
			format: "yaml",
			behavior: "classical",
			url: `${BM7_BASE}/${name}/${name}.yaml`,
			path: `./ruleset/bm7-${name.toLowerCase()}.yaml`,
			interval: 86400,
		},
	};
}

function uniqueList(items) {
	return [...new Set(items.filter(Boolean))];
}

function getProxyGroupNames(config) {
	return (config["proxy-groups"] || []).map((group) => group.name);
}

function findSmartGroup(config) {
	const groupNames = getProxyGroupNames(config);
	return SMART_GROUP_CANDIDATES.find((name) => groupNames.includes(name))
		|| groupNames[0]
		|| null;
}

function upsertProxy(config, proxy) {
	const proxies = config.proxies || [];
	const index = proxies.findIndex((item) => item.name === proxy.name);
	config.proxies = index === -1
		? [...proxies, proxy]
		: proxies.map((item, current) => current === index ? proxy : item);
}

function upsertProxyGroup(config, group) {
	const groups = config["proxy-groups"] || [];
	const index = groups.findIndex((item) => item.name === group.name);
	config["proxy-groups"] = index === -1
		? [...groups, group]
		: groups.map((item, current) => current === index ? group : item);
}

function ensureRelayProxy(config, smartGroup) {
	const relayProxy = {
		name: RELAY_PROXY_NAME,
		type: "socks5",
		server: RELAY_IP,
		port: 443,
		username: RELAY_USERNAME,
		password: RELAY_PASSWORD,
		"skip-cert-verify": true,
	};

	if (smartGroup) {
		relayProxy["dialer-proxy"] = smartGroup;
	}

	upsertProxy(config, relayProxy);
}

function ensureAiGroups(config, smartGroup) {
	const routeMembers = uniqueList([RELAY_PROXY_NAME, smartGroup]);
	const aiMembers = uniqueList([GROUP.AI_ROUTE, smartGroup, "DIRECT"]);

	upsertProxyGroup(config, {
		name: GROUP.AI_ROUTE,
		type: "fallback",
		proxies: routeMembers,
		url: "http://www.gstatic.com/generate_204",
		interval: 300,
		lazy: false,
		hidden: true,
	});

	upsertProxyGroup(config, {
		name: GROUP.AI,
		type: "select",
		proxies: aiMembers,
	});
}

function ensureAiRuleProviders(config) {
	config["rule-providers"] = {
		...(config["rule-providers"] || {}),
		...bm7Provider("OpenAI"),
		...bm7Provider("Claude"),
		...bm7Provider("Gemini"),
	};
}

function buildAiRules() {
	return [
		...aiDomainSuffixes.map((suffix) => `DOMAIN-SUFFIX,${suffix},${GROUP.AI}`),
		`RULE-SET,openai,${GROUP.AI}`,
		`RULE-SET,claude,${GROUP.AI}`,
		`RULE-SET,gemini,${GROUP.AI}`,
	];
}

function ensureAiRules(config) {
	const existingRules = config.rules || [];
	const aiRules = buildAiRules();
	const aiRuleSetNames = new Set(["openai", "claude", "gemini"]);

	const withoutOldAiRules = existingRules.filter((rule) => {
		if (typeof rule !== "string") {
			return true;
		}

		const [type, payload, target] = rule.split(",");
		return !(
			target === GROUP.AI
			|| aiDomainSuffixes.includes(payload)
			|| (type === "RULE-SET" && aiRuleSetNames.has(payload))
		);
	});

	config.rules = [...aiRules, ...withoutOldAiRules];
}

function main(config) {
	const smartGroup = findSmartGroup(config);

	ensureRelayProxy(config, smartGroup);
	ensureAiGroups(config, smartGroup);
	ensureAiRuleProviders(config);
	ensureAiRules(config);

	return config;
}
