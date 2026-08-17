export const TEAM_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'leadership',
    name: 'Leadership & decisions',
    description: 'Turn a business question into a decision, action plan, and Workspace follow-through.',
    agentKeys: Object.freeze(['fred', 'darren', 'jess', 'atlas']),
  }),
  Object.freeze({
    id: 'revenue',
    name: 'Revenue & business development',
    description: 'Find and enrich prospects, qualify fit, and prepare the commercial next step.',
    agentKeys: Object.freeze(['scout', 'enrichment', 'radar', 'darren']),
  }),
  Object.freeze({
    id: 'target-contact',
    name: 'Target contact research',
    description: 'Find verified information about a specific person or company, then prepare the commercial next step—without screening the target out.',
    agentKeys: Object.freeze(['enrichment', 'darren']),
  }),
  Object.freeze({
    id: 'marketing',
    name: 'Marketing & content',
    description: 'Research an audience, shape the message, and create Workspace-ready content.',
    agentKeys: Object.freeze(['scout', 'fred', 'darren', 'atlas']),
  }),
  Object.freeze({
    id: 'delivery',
    name: 'Research, build & review',
    description: 'Gather evidence, create a draft, and independently check it before you use it.',
    agentKeys: Object.freeze(['scout', 'forge', 'sentinel']),
  }),
]);

export function rosterIdsForTeam(teamId, roster) {
  const team = TEAM_TEMPLATES.find((item) => item.id === teamId);
  if (!team) return [];
  const wanted = new Set(team.agentKeys);
  return (roster || [])
    .filter((entry) => entry.enabled && wanted.has(entry.template_key))
    .map((entry) => entry.id);
}

export function teamIdForRosterSelection(selectedIds, roster) {
  if (!selectedIds || !(roster || []).length) return 'custom';
  const selected = (roster || [])
    .filter((entry) => entry.enabled)
    .filter((entry) => selectedIds.has(entry.id))
    .map((entry) => entry.id)
    .sort();

  for (const team of TEAM_TEMPLATES) {
    const expected = rosterIdsForTeam(team.id, roster).slice().sort();
    if (expected.length && expected.length === selected.length && expected.every((id, index) => id === selected[index])) {
      return team.id;
    }
  }
  return 'custom';
}
