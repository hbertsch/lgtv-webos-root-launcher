// Pure helper for pihole-rules.mjs: which wanted rules are not in the Pi-hole yet.

function ruleKey(rule) {
  return `${rule.type}/${rule.kind}/${rule.domain}`;
}

export function findMissingRules(existingRules, wantedRules) {
  const existingKeys = new Set(existingRules.map(ruleKey));
  return wantedRules.filter((rule) => !existingKeys.has(ruleKey(rule)));
}
