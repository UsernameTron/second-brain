export const TEAM_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'leadership',
    name: 'Leadership & decisions',
    description: 'Turn a business question into a decision, action plan, and Workspace follow-through.',
    agentNames: Object.freeze(['Fred', 'Darren', 'Jess', 'Atlas']),
  }),
  Object.freeze({
    id: 'revenue',
    name: 'Revenue & business development',
    description: 'Find and enrich prospects, qualify fit, and prepare the commercial next step.',
    agentNames: Object.freeze(['Scout', 'Enrichment', 'Radar', 'Darren']),
  }),
  Object.freeze({
    id: 'target-contact',
    name: 'Target contact research',
    description: 'Find verified information about a specific person or company, then prepare the commercial next step—without screening the target out.',
    agentNames: Object.freeze(['Enrichment', 'Darren']),
  }),
  Object.freeze({
    id: 'marketing',
    name: 'Marketing & content',
    description: 'Research an audience, shape the message, and create Workspace-ready content.',
    agentNames: Object.freeze(['Scout', 'Fred', 'Darren', 'Atlas']),
  }),
  Object.freeze({
    id: 'delivery',
    name: 'Research, build & review',
    description: 'Gather evidence, create a draft, and independently check it before you use it.',
    agentNames: Object.freeze(['Scout', 'Forge', 'Sentinel']),
  }),
]);

export function rosterIdsForTeam(teamId, roster) {
  const team = TEAM_TEMPLATES.find((item) => item.id === teamId);
  if (!team) return [];
  const wanted = new Set(team.agentNames);
  return (roster || [])
    .filter((entry) => entry.enabled && wanted.has(entry.name))
    .map((entry) => entry.id);
}

export function teamIdForRosterSelection(selectedIds, roster) {
  if (!selectedIds || !(roster || []).length) return 'custom';
  const enabled = (roster || []).filter((entry) => entry.enabled);
  const enabledNames = new Set(enabled.map((entry) => entry.name));
  const selectedNames = enabled
    .filter((entry) => selectedIds.has(entry.id))
    .map((entry) => entry.name)
    .sort();

  for (const team of TEAM_TEMPLATES) {
    const expectedNames = team.agentNames.filter((name) => enabledNames.has(name)).slice().sort();
    if (expectedNames.length === selectedNames.length && expectedNames.every((name, index) => name === selectedNames[index])) {
      return team.id;
    }
  }
  return 'custom';
}
