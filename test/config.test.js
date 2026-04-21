'use strict';

const path = require('path');

describe('Task 1: Config files and utils', () => {
  const projectRoot = path.join(__dirname, '..');

  test('vault-paths.json is valid JSON with correct left and right arrays', () => {
    const vp = require(path.join(projectRoot, 'config/vault-paths.json'));
    expect(vp.left).toBeInstanceOf(Array);
    expect(vp.right).toBeInstanceOf(Array);
    expect(vp.left).toContain('ABOUT ME');
    expect(vp.right).toContain('proposals');
    expect(vp.right).toHaveLength(9);
  });

  test('excluded-terms.json is valid JSON array containing required terms', () => {
    const et = require(path.join(projectRoot, 'config/excluded-terms.json'));
    expect(et).toBeInstanceOf(Array);
    expect(et).toContain('ISPN');
    expect(et).toContain('Genesys');
    expect(et).toContain('Asana');
  });

  test('package.json has correct dependencies and no "type: module"', () => {
    const pkg = require(path.join(projectRoot, 'package.json'));
    expect(pkg.dependencies['@anthropic-ai/sdk']).toBeTruthy();
    expect(pkg.devDependencies['jest']).toBeTruthy();
    expect(pkg.type).toBeUndefined();
    expect(pkg.main).toBe('src/vault-gateway.js');
  });

  test('src/utils.js exports escapeRegex function', () => {
    const { escapeRegex } = require(path.join(projectRoot, 'src/utils.js'));
    expect(typeof escapeRegex).toBe('function');
  });

  test('escapeRegex correctly escapes regex metacharacters', () => {
    const { escapeRegex } = require(path.join(projectRoot, 'src/utils.js'));
    expect(escapeRegex('C++')).toBe('C\\+\\+');
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('(test)')).toBe('\\(test\\)');
    expect(escapeRegex('simple')).toBe('simple');
    expect(escapeRegex('$var')).toBe('\\$var');
    expect(escapeRegex('[bracket]')).toBe('\\[bracket\\]');
  });
});
