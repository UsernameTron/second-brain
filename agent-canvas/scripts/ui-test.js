'use strict';
// Repeat the complete local browser acceptance suite; stop on the first failure.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const checks = [
  ['journey-test.js'],
  ...['rooms-memory', 'scheduling-builder', 'owner-diagnostics', 'workspace-tools', 'needs-you', 'system-recovery', 'draft-safety', 'home-navigation', 'review-navigation']
    .map((group) => ['acceptance-test.js', group]),
];
const results = [];
for (const [script, ...args] of checks) {
  const label = args[0] || 'primary-journeys';
  console.log(`\nUI acceptance: ${label}`);
  const child = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit' });
  if (child.error || child.status !== 0) {
    console.error(`UI acceptance stopped at ${label}: ${child.error?.message || child.signal || `exit ${child.status}`}`);
    process.exit(child.status || 1);
  }
  results.push({ group: label, status: 'passed' });
}
fs.writeFileSync(path.join(__dirname, '../docs/screenshots/ui-test-summary.json'), `${JSON.stringify({
  checkedAt: new Date().toISOString(), results,
  scope: 'Local Chromium, disposable databases and test-only external boundaries. Live Google OAuth, integrations and physical microphone are not verified.',
}, null, 2)}\n`);
console.log('\nAll local UI acceptance groups passed.');
