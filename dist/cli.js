#!/usr/bin/env node
/**
 * memrot - audit an AI agent's memory, read-only.
 *
 *   memrot audit <store.rl> [--format text|json] [--stale-days N]
 *                             [--as-of YYYY-MM-DD] [--near-dup-threshold X]
 *   memrot believed-at <store> --at <ISO time> [--subject <name>] [--format text|json]
 *   memrot why <store> <fact-id> [--format text|json]
 *   memrot seed <path.rl>
 *
 * Exit codes: 0 = clean (or command done), 1 = audit found errors,
 * 2 = usage error or store error (missing, locked, unreadable).
 * memrot never writes to the store under audit.
 */
import { existsSync } from "node:fs";
import { openReadOnly, StoreError } from "./store.js";
import { DEFAULT_OPTIONS, runAllChecks } from "./checks.js";
import { buildReport, formatJson, formatText } from "./report.js";
import { believedAt, normalizeTime, why } from "./queries.js";
import { buildSeededStore } from "./seed.js";
export const VERSION = "0.1.0";
const HELP = `memrot ${VERSION} - audit an AI agent's memory, read-only.

USAGE
  memrot audit <store> [--format text|json] [--stale-days N]
                       [--as-of YYYY-MM-DD] [--near-dup-threshold X]
  memrot believed-at <store> --at <ISO time> [--subject <name>] [--format text|json]
  memrot why <store> <fact-id> [--format text|json]
  memrot seed <path.rl>

COMMANDS
  audit        Run all seven checks over a Relate store (.rl file or
               directory). Exit 1 when any error-severity finding exists,
               exit 0 when clean. Warnings alone do not fail the audit.
  believed-at  List what the agent believed at a time: facts whose
               validity window covers the time and that were recorded
               by then. Superseded facts are shown and marked.
  why          Show one fact's provenance: its episode, supporters,
               what supersedes it, and what contradicts it.
  seed         Create a new store with the seeded demo memory (the same
               dirty memory as examples/demo.rl) so you can try the
               audit in one command. Refuses to overwrite.

OPTIONS
  --format text|json   Output format (default text; JSON is for CI).
  --stale-days N       Facts older than N days with no corroboration
                       count as stale (default 90).
  --as-of YYYY-MM-DD   Audit date (default today, UTC). Pins the
                       stale/expired cutoffs; use it for repeatable runs.
  --near-dup-threshold X  Cosine threshold for near-duplicates
                       (default 0.91, on Relate's scale where 0.5 is
                       orthogonal and 1.0 is identical).

STORES AND LOCKS
  memrot opens the store read-only and never writes to it. A .rl file
  held by a running agent cannot be opened read-only: stop the writer
  first, or clone after it exits (relate clone store.rl snapshot.rl)
  and audit the snapshot. A directory store CAN be opened read-only
  beside a live writer.

EXAMPLES
  memrot seed demo.rl
  memrot audit demo.rl
  memrot audit demo.rl --format json
  memrot believed-at demo.rl --at 2026-02-15
  memrot why demo.rl f-db-15
`;
function parseFlags(args) {
    const flags = {
        format: "text",
        staleDays: DEFAULT_OPTIONS.staleDays,
        asOf: DEFAULT_OPTIONS.asOf,
        nearDupThreshold: DEFAULT_OPTIONS.nearDupThreshold,
    };
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--format") {
            const v = args[++i];
            if (v !== "text" && v !== "json")
                throw new StoreError(`--format must be text or json, got: ${v}`);
            flags.format = v;
        }
        else if (a === "--stale-days") {
            const v = Number(args[++i]);
            if (!Number.isFinite(v) || v < 0)
                throw new StoreError(`--stale-days must be a non-negative number, got: ${args[i]}`);
            flags.staleDays = v;
        }
        else if (a === "--as-of") {
            const v = args[++i];
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
                throw new StoreError(`--as-of must be YYYY-MM-DD, got: ${v}`);
            flags.asOf = v;
        }
        else if (a === "--near-dup-threshold") {
            const v = Number(args[++i]);
            if (!Number.isFinite(v) || v < 0 || v > 1)
                throw new StoreError(`--near-dup-threshold must be between 0 and 1, got: ${args[i]}`);
            flags.nearDupThreshold = v;
        }
        else if (a === "--at") {
            flags.at = args[++i];
        }
        else if (a === "--subject") {
            flags.subject = args[++i];
        }
        else if (a.startsWith("--")) {
            throw new StoreError(`unknown option: ${a}\nRun: memrot --help`);
        }
        else {
            positional.push(a);
        }
    }
    return { positional, flags };
}
function printBelieved(store, at, subject, format) {
    const db = openReadOnly(store);
    const facts = believedAt(db.connect(), normalizeTime(at), subject);
    if (format === "json") {
        console.log(JSON.stringify({ tool: "memrot", version: VERSION, store, at, subject: subject ?? null, facts }, null, 2));
        return 0;
    }
    console.log(`memrot believed-at: ${store} at ${at}${subject ? ` (subject ${subject})` : ""}`);
    console.log("");
    if (facts.length === 0) {
        console.log("No facts believed at this time.");
        return 0;
    }
    for (const f of facts) {
        const window = `${f.validFrom ?? "?"} to ${f.validTo ?? "open"}`;
        const mark = f.status === "current" ? "" : ` [${f.status}]`;
        console.log(`  ${f.subject}.${f.predicate} = "${f.object}" (${f.id})${mark}`);
        console.log(`    valid ${window}, recorded ${f.createdAt}`);
    }
    console.log("");
    console.log(`${facts.length} fact(s) believed at ${at}.`);
    return 0;
}
function printWhy(store, factId, format) {
    const db = openReadOnly(store);
    const result = why(db.connect(), factId);
    if (result === null) {
        throw new StoreError(`no fact with id ${factId} in ${store}`);
    }
    if (format === "json") {
        console.log(JSON.stringify({ tool: "memrot", version: VERSION, store, ...result }, null, 2));
        return 0;
    }
    const f = result.fact;
    console.log(`memrot why: ${store} ${factId}`);
    console.log("");
    console.log(`  ${f.subject}.${f.predicate} = "${f.object}"`);
    console.log(`  status ${f.status}, valid ${f.validFrom ?? "?"} to ${f.validTo ?? "open"}, recorded ${f.createdAt}`);
    console.log("");
    if (result.episode) {
        console.log(`  provenance: ${result.episode.source} at ${result.episode.at}`);
        console.log(`    "${result.episode.text}"`);
    }
    else {
        console.log(`  provenance: NONE - no episode recorded where this fact came from.`);
    }
    console.log(`  supporters: ${result.supporters.length === 0 ? "none" : result.supporters.join(", ")}`);
    console.log(`  superseded by: ${result.supersededBy.length === 0 ? "none" : result.supersededBy.join(", ")}`);
    console.log(`  supersedes: ${result.supersedes.length === 0 ? "none" : result.supersedes.join(", ")}`);
    if (result.contradicts.length === 0) {
        console.log(`  contradicts: none`);
    }
    else {
        console.log(`  contradicts:`);
        for (const c of result.contradicts)
            console.log(`    ${c.id}: "${c.object}"`);
    }
    return 0;
}
function runAudit(store, flags) {
    const db = openReadOnly(store);
    const results = runAllChecks(db.connect(), {
        asOf: flags.asOf,
        staleDays: flags.staleDays,
        nearDupThreshold: flags.nearDupThreshold,
    });
    const report = buildReport(store, flags.asOf, results, VERSION);
    if (flags.format === "json") {
        console.log(formatJson(report));
    }
    else {
        console.log(formatText(report));
    }
    return report.summary.failed ? 1 : 0;
}
function runSeed(path) {
    if (existsSync(path)) {
        throw new StoreError(`store already exists: ${path}\n  memrot seed refuses to overwrite. Delete it first, or pick another path.`);
    }
    buildSeededStore(path);
    console.log(`Created seeded demo store: ${path}`);
    console.log(`  11 facts, 6 entities, 8 episodes, 7 planted faults (see examples/seed.cypher).`);
    console.log(`Next: memrot audit ${path}`);
    return 0;
}
export function main(argv) {
    const [cmd, ...rest] = argv;
    if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") {
        console.log(HELP);
        return 0;
    }
    if (cmd === "--version" || cmd === "-v") {
        console.log(`memrot ${VERSION}`);
        return 0;
    }
    try {
        if (cmd === "audit") {
            const { positional, flags } = parseFlags(rest);
            if (positional.length !== 1)
                throw new StoreError(`usage: memrot audit <store>\nRun: memrot --help`);
            return runAudit(positional[0], flags);
        }
        if (cmd === "believed-at") {
            const { positional, flags } = parseFlags(rest);
            if (positional.length !== 1)
                throw new StoreError(`usage: memrot believed-at <store> --at <ISO time>\nRun: memrot --help`);
            if (!flags.at)
                throw new StoreError(`believed-at needs --at <ISO time>, e.g. --at 2026-02-15`);
            return printBelieved(positional[0], flags.at, flags.subject, flags.format);
        }
        if (cmd === "why") {
            const { positional, flags } = parseFlags(rest);
            if (positional.length !== 2)
                throw new StoreError(`usage: memrot why <store> <fact-id>\nRun: memrot --help`);
            return printWhy(positional[0], positional[1], flags.format);
        }
        if (cmd === "seed") {
            const { positional } = parseFlags(rest);
            if (positional.length !== 1)
                throw new StoreError(`usage: memrot seed <path.rl>\nRun: memrot --help`);
            return runSeed(positional[0]);
        }
        throw new StoreError(`unknown command: ${cmd}\nRun: memrot --help`);
    }
    catch (err) {
        if (err instanceof StoreError) {
            console.error(`memrot: ${err.message}`);
            return err.exitCode;
        }
        throw err;
    }
}
process.exitCode = main(process.argv.slice(2));
