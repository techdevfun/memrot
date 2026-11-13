# Contributing to vendormap

## Ground rules

- vendormap measures concentration only. No CVE/version data, no spend or billing data, no secret scanning, no auto-remediation. If a feature touches those, it belongs in a different tool.
- No invented numbers. Scores in fixtures and docs are the fixture's own, labeled as such. No switching-cost or savings claims.
- Never read, print or store env values or file contents. Output is paths, line numbers and counts only. Real `.env`, `*secret*`, `*.pem` and `*.key` files are skipped entirely.
- All public content is ASCII English only. No em dash - use `-` (hyphen). Run `npm run preflight` before opening a PR.
- TypeScript strict, zero runtime dependencies, Node 20+.

## Workflow

```sh
npm install
npm run build     # tsc strict, must be clean
npm test          # unit + e2e (27 tests)
npm run test:live # live smoke (npm + GitHub 404 re-checks)
npm run preflight # ASCII-only + no-internal-names scan
npm run bench     # scan timing over the demo fixtures
```

## Adding a vendor or a category

1. Add the match patterns to `src/vendors.ts` (one category, one vendor).
2. Add alternatives for the vendor to the `ALTERNATIVES` table in the same file, stamped with today's date in `ALTERNATIVES_VERIFIED`.
3. Add a fixture case to `examples/` (or extend the existing ones) and lock the expected numbers into `test/e2e.test.js`.
4. Update the README tables (What it scans, Categories) if the surface changed.

## Adding a scan source

1. Add a `scan*` function in `src/scan.ts` and wire it into the file-type dispatch in `scanDir`.
2. Record the new source kind in `SOURCE_KINDS` so the coverage note stays honest.
3. Add a unit test proving the source contributes counts, and a test proving file contents never leak into output.
