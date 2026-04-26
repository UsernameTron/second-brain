// Requirement: AGENT-VERIFY-01
// Contract tests: verify that test-verifier.md contains the Phase-Closure Verification Mode
// instruction set. These tests do NOT run the agent — they validate the instruction contract
// is complete and parseable by checking required strings are present in the agent file.

'use strict';

const fs = require('fs');
const path = require('path');

const AGENT_FILE = path.join(__dirname, '../../.claude/agents/test-verifier.md');

let agentContent;
beforeAll(() => {
  agentContent = fs.readFileSync(AGENT_FILE, 'utf8');
});

describe('test-verifier agent: Phase-Closure Verification Mode (AGENT-VERIFY-01)', () => {
  test('contains "Phase-Closure Verification Mode" section header', () => {
    expect(agentContent).toContain('Phase-Closure Verification Mode');
  });

  test('contains invocation trigger pattern "phase-close"', () => {
    expect(agentContent).toContain('phase-close');
  });

  test('contains invocation trigger pattern "verify requirements:"', () => {
    expect(agentContent).toContain('verify requirements:');
  });

  test('contains grep scope restriction "--include=*.test.js"', () => {
    expect(agentContent).toContain('--include=*.test.js');
  });

  test('contains all three verdict values: PASS, FAIL, UNTESTED', () => {
    expect(agentContent).toContain('PASS');
    expect(agentContent).toContain('FAIL');
    expect(agentContent).toContain('UNTESTED');
  });

  test('retains original "Test Verification Report" output format (backward compat)', () => {
    expect(agentContent).toContain('Test Verification Report');
  });

  test('contains "AGENT-VERIFY-01" as a self-referencing requirement tag', () => {
    expect(agentContent).toContain('AGENT-VERIFY-01');
  });
});
