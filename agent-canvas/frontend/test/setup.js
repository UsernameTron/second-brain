import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

// The rule cards decide "overdue" by comparing next_run_at against Date.now()
// (RulesView.jsx), so every fixture with a fixed future date silently becomes a
// time bomb: it passes until the wall clock rolls past it, then fails on a
// change that touched nothing. Two of them detonated on 2026-08-16 at 08:00 UTC.
// Pin the clock once, here, so the whole suite is a function of its fixtures and
// not of the day it runs.
//
// Date.now ONLY — deliberately not vi.useFakeTimers(). userEvent and waitFor
// need real setTimeout/setInterval to make progress, and faking them globally
// would hang the suite. The three tests that DO want fake timers install them
// inside the test and call useRealTimers() before returning; they inherit this
// pin as their start instant, which makes them more deterministic, not less.
const PINNED_NOW = Date.parse('2026-08-16T07:00:00Z');

let nowSpy;
beforeEach(() => { nowSpy = vi.spyOn(Date, 'now').mockReturnValue(PINNED_NOW); });
afterEach(() => { nowSpy.mockRestore(); });
