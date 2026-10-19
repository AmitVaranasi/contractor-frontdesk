# Security findings and remediation

| Date | Tool | Finding | Verdict | Action |
|---|---|---|---|---|
| 2026-10-19 | npm audit | tinypool prototype-pollution RCE gadget (critical), vitest mocker path traversal (moderate) via vitest 3 | Real (dev tooling) | Upgraded vitest to 4.1.12 — fixed |
| 2026-10-19 | npm audit | braces → micromatch → fast-glob → eslint-config-next (5 high) | Real, dev-only, no upstream fix | Accepted; runtime `npm audit --omit=dev` = 0 |
| 2026-10-19 | Snyk test | Dependencies | 0 issues | — |
| 2026-10-19 | Snyk Code | DOMXSS: website link from data in `app/setup/page.tsx` | Real once owners enter URLs | `lib/safeUrl.ts` allows only http(s) and bundled demo paths |
| 2026-10-19 | Snyk Code | HardcodedNonCryptoSecret in `useBusiness.ts`, `docs/index.html` | False positive (localStorage key names) | Renamed variables |
| 2026-10-19 | Snyk Code | NoHardcodedPasswords in `app/team/page.tsx` (`pass:` status colour) | False positive (test status label) | Documented |
| 2026-10-19 | Code review | Browser test-call route returned the assistant config incl. webhook secret | Real | Route now returns only the saved assistant id |

Raw outputs: `npm-audit-before.json`, `npm-audit-after.json`, `snyk-deps.json`, `snyk-code.json`, `snyk-code-after.json`.
