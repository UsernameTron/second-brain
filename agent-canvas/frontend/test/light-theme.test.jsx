import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolvePath(process.cwd(), 'src/styles.css'), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(selector) {
  const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`));
  expect(match, `missing CSS rule: ${selector}`).not.toBeNull();
  return match[1];
}

function declaration(block, property) {
  const match = block.match(new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+)`));
  expect(match, `missing CSS declaration: ${property}`).not.toBeNull();
  return match[1].trim();
}

function variables(selector) {
  const entries = {};
  for (const match of rule(selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    entries[match[1]] = match[2].trim();
  }
  return entries;
}

function resolve(value, vars) {
  let resolved = value;
  for (let i = 0; i < 10; i += 1) {
    const next = resolved.replace(/var\((--[\w-]+)\)/g, (_, name) => vars[name] || `var(${name})`);
    if (next === resolved) return resolved;
    resolved = next;
  }
  return resolved;
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => {
    const channel = Number.parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe('light-theme CSS contracts', () => {
  it('contains wide navigation inside the topbar and keeps mobile panels above the review tray', () => {
    const topbar = rule('.topbar');
    expect(declaration(topbar, 'max-width')).toBe('100vw');
    expect(declaration(topbar, 'overflow-x')).toBe('auto');
    expect(declaration(topbar, 'overflow-y')).toBe('hidden');
    expect(declaration(rule('.canvas-new-pop'), 'position')).toBe('fixed');
    expect(css).toMatch(/\.panel, \.panel-wide \{[^}]*z-index:\s*70;/);
  });

  it('resets topbar styling inside both light-surface creation popovers', () => {
    const popover = rule('.canvas-new-pop');
    expect(declaration(popover, 'color')).toBe('var(--text)');

    const input = rule('.topbar .canvas-new-pop .canvas-new-input');
    expect(declaration(input, 'background')).toBe('var(--bg1)');
    expect(declaration(input, 'color')).toBe('var(--text)');
    expect(declaration(input, 'border-color')).toBe('var(--text-faint)');

    const placeholder = rule('.topbar .canvas-new-pop .canvas-new-input::placeholder');
    expect(declaration(placeholder, 'color')).toBe('var(--text-dim)');
    expect(declaration(placeholder, 'opacity')).toBe('1');

    const button = rule('.topbar .canvas-new-pop .btn');
    expect(declaration(button, 'background')).toBe('var(--bg1)');
    expect(declaration(button, 'color')).toBe('var(--text)');

    const primary = rule('.topbar .canvas-new-pop .btn.primary');
    expect(declaration(primary, 'background')).toBe('var(--ctg-navy)');
    expect(declaration(primary, 'color')).toBe('var(--cream)');

    const disabled = rule('.topbar .canvas-new-pop .btn:disabled');
    expect(declaration(disabled, 'background')).toBe('var(--bg3)');
    expect(declaration(disabled, 'color')).toBe('var(--text-dim)');
    expect(declaration(disabled, 'opacity')).toBe('1');
  });

  it('keeps Add Agent controls and boundaries visible without undefined tokens', () => {
    expect(css).not.toContain('var(--dim');
    expect(declaration(rule('.authority-desc'), 'color')).toBe('var(--text-dim)');

    const roster = rule('.add-agent-modal .roster-pick');
    expect(declaration(roster, 'background')).toBe('var(--bg2)');
    expect(declaration(roster, 'border-color')).toBe('var(--text-faint)');

    const section = rule('.add-agent-modal .builder-flow > section');
    expect(declaration(section, 'border')).toBe('1px solid var(--text-faint)');
    expect(declaration(section, 'background')).toBe('var(--bg2)');

    const authority = rule('.add-agent-modal .authority-list');
    expect(declaration(authority, 'border')).toBe('1px solid var(--text-faint)');

    const activeTab = rule('.add-agent-modal .modal-tabs button.active');
    expect(declaration(activeTab, 'box-shadow')).toBe('inset 0 -3px 0 var(--blue)');

    const disabled = rule('.add-agent-modal .btn:disabled');
    expect(declaration(disabled, 'opacity')).toBe('1');
    expect(declaration(disabled, 'color')).toBe('var(--text-dim)');
    expect(declaration(disabled, 'background')).toBe('var(--bg3)');
  });

  it('keeps small light-theme semantic text at WCAG AA contrast', () => {
    const root = variables(':root');
    const background = resolve(root['--bg1'], root);
    expect(declaration(rule('.add-agent-modal h3'), 'color')).toBe('var(--blue)');
    expect(declaration(rule('.add-agent-modal .tier-fast'), 'color')).toBe('var(--magenta)');
    expect(declaration(rule('.add-agent-modal .tier-strong'), 'color')).toBe('var(--blue)');

    for (const name of ['--text-dim', '--text-faint', '--magenta', '--blue']) {
      const foreground = resolve(root[name], root);
      expect(foreground, `${name} must resolve to a hex color`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(foreground, background), `${name} contrast on --bg1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
