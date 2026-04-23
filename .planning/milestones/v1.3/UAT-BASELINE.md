# UAT-01 Classification Accuracy — Pre-existing Baseline

Status: pre-existing failure, not a Phase 12 regression.
Root cause: requires live LLM (UAT tests hit real Anthropic API or local LM Studio endpoint).
Resolution path: v1.3 Phase 14 T14.5 — add process.env.CI skip guard and `test:uat` script that unsets CI for local runs.
Baseline captured on commit: 0eff2cebaa7d883ead5f458c73d638fbb4371f5f

```
  console.log
    ====================================

      at Object.log (test/uat/uat-classification.test.js:175:13)

FAIL test/uat/uat-classification.test.js
  ● UAT-01: Classification accuracy validation › Overall accuracy must be >= 80%

    expect(received).toBeGreaterThanOrEqual(expected)

    Expected: >= 0.8
    Received:    0

      258 |     const accuracy = correct / deterministic.length;
      259 |
    > 260 |     expect(accuracy).toBeGreaterThanOrEqual(0.8);
          |                      ^
      261 |   });
      262 | });
      263 |

      at Object.toBeGreaterThanOrEqual (test/uat/uat-classification.test.js:260:22)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 16 passed, 17 total
Snapshots:   0 total
Time:        0.668 s, estimated 1 s
Ran all test suites matching test/uat/uat-classification.test.js.
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```
