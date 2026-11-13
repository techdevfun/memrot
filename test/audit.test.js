/**
 * Audit checks against the seeded fixture with KNOWN ground truth.
 * Every check is asserted by exact fact id (or pair), not by count
 * alone, so a check that flags the wrong facts fails loudly.
 *
 * Process note: @relate/relate 1.0.1 exposes no close() on Database,
 * so a writable handle releases its lock only when GC collects it.
 * Tests therefore build every store in a CHILD process (CLI seed, or
 * a generated setup script) and audit in-process: the child exits,
 * the lock is released deterministically, and the audit opens
 * read-only without racing the collector.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openReadOnly } from "../dist/store.js";
import { DEFAULT_OPTIONS, runAllChecks } from "../dist/checks.js";
import { believedAt, why } from "../dist/queries.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const RELATE_ENTRY = fileURLToPath(new URL("../node_modules/@relate/relate/index.js", import.meta.url));
const VECTORS_ENTRY = fileURLToPath(new URL("../dist/vectors.js", import.meta.url));

function tmpDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "memrot-audit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seededStore(t) {
  const path = join(tmpDir(t), "demo.rl");
  execFileSync("node", [CLI, "seed", path], { encoding: "utf8" });
  return path;
}

/**
 * Build a store in a child process from setup Cypher/JS. `setup` is
 * code run with `db` (writable Database) and `c` (connection) in
 * scope; it may use trigramVector/factText/EMBEDDING_DIM.
 */
function buildViaChild(t, setup) {
  const dir = tmpDir(t);
  const script = join(dir, "setup.mjs");
  writeFileSync(
    script,
    `import { Database } from ${JSON.stringify(RELATE_ENTRY)};\n` +
      `import { trigramVector, factText, EMBEDDING_DIM } from ${JSON.stringify(VECTORS_ENTRY)};\n` +
      `const db = Database.open(process.argv[2]);\n` +
      `const c = db.connect();\n` +
      `${setup}\n` +
      `db.checkpoint();\n`,
  );
  const path = join(dir, "store.rl");
  execFileSync("node", [script, path], { encoding: "utf8" });
  return path;
}

function audit(path, opts = {}) {
  const db = openReadOnly(path);
  return runAllChecks(db.connect(), { ...DEFAULT_OPTIONS, asOf: "2026-11-13", ...opts });
}

function byId(results, id) {
  return results.find((c) => c.id === id);
}

function factIds(result) {
  return result.findings.map((f) => f.factId).sort();
}

function pairIds(result) {
  return result.findings
    .map((f) => [f.evidence.aId, f.evidence.bId].sort().join("+"))
    .sort();
}

test("seeded store: every check finds exactly its planted faults", (t) => {
  const results = audit(seededStore(t));

  assert.deepEqual(pairIds(byId(results, "contradiction")), ["f-db-15+f-db-16", "f-queue-4000+f-queue-8000"]);
  assert.deepEqual(factIds(byId(results, "superseded-served")), ["f-db-15"]);
  assert.deepEqual(factIds(byId(results, "stale")), ["f-cache-ttl", "f-feature-flag"]);
  assert.deepEqual(byId(results, "orphaned").findings.map((f) => f.evidence.id), ["e-legacycron"]);
  assert.deepEqual(factIds(byId(results, "provenance-less")), ["f-deploy-region"]);
  assert.deepEqual(factIds(byId(results, "validity-order")), ["f-feature-flag"]);
  assert.deepEqual(pairIds(byId(results, "near-duplicate")), ["f-db-16+f-db-16b"]);

  const total = results.reduce((n, c) => n + c.findings.length, 0);
  assert.equal(total, 9);
  const errors = results.flatMap((c) => c.findings).filter((f) => f.severity === "error").length;
  assert.equal(errors, 5);
});

test("seeded store: clean controls are never flagged", (t) => {
  const results = audit(seededStore(t));
  const flagged = new Set(results.flatMap((c) => c.findings.map((f) => f.factId)));
  for (const clean of ["f-deploy-replicas", "f-feature-darkmode", "f-cache-backend"]) {
    assert.ok(!flagged.has(clean), `${clean} must not be flagged`);
  }
});

test("stale check is pinned by --as-of: earlier date finds nothing stale", (t) => {
  const results = audit(seededStore(t), { asOf: "2026-03-01" });
  assert.deepEqual(byId(results, "stale").findings, []);
  // The contradiction check is structural (current store state), not
  // pinned by as-of: both pairs are still found in March.
  assert.equal(byId(results, "contradiction").findings.length, 2);
});

test("near-duplicate check falls back to a cosine scan when no vector index exists", (t) => {
  // Same two facts as the fixture pair, embeddings present, NO index.
  const path = buildViaChild(
    t,
    `for (const [id, subject, predicate, object] of [
       ["f-db-16", "database", "engine", "Postgres 16"],
       ["f-db-16b", "database", "db_engine", "PostgreSQL 16"],
       ["f-other", "cache", "backend", "redis"],
     ]) {
       const v = trigramVector(factText(subject, predicate, object), EMBEDDING_DIM);
       c.query("CREATE (:Fact {id: $id, subject: $s, predicate: $p, object: $o, status: 'current', embedding: $v})", {
         id, s: subject, p: predicate, o: object, v,
       });
     }`,
  );
  const results = audit(path);
  assert.deepEqual(pairIds(byId(results, "near-duplicate")), ["f-db-16+f-db-16b"]);
});

test("clean store: all checks pass", (t) => {
  const path = buildViaChild(
    t,
    `c.query("CREATE (:Entity {id: 'e1', name: 'Queue', kind: 'service'})");
     c.query("CREATE (:Episode {id: 'ep1', source: 'session 2026-11-01T09:00Z', at: '2026-11-01T09:30:00Z', text: 'review'})");
     c.query("CREATE (:Fact {id: 'f1', subject: 'queue', predicate: 'max_payload', object: '4000 bytes', validFrom: '2026-11-01', validTo: null, createdAt: '2026-11-01T09:30:00Z', status: 'current'})");
     c.query("MATCH (f:Fact {id: 'f1'}), (e:Entity {id: 'e1'}) CREATE (f)-[:ABOUT]->(e)");
     c.query("MATCH (f:Fact {id: 'f1'}), (ep:Episode {id: 'ep1'}) CREATE (f)-[:FROM_EPISODE]->(ep)");`,
  );
  const results = audit(path);
  for (const r of results) assert.deepEqual(r.findings, [], `${r.id} should be clean`);
});

test("believed-at 2026-02-15 returns exactly the five facts believed then", (t) => {
  const db = openReadOnly(seededStore(t));
  const facts = believedAt(db.connect(), "2026-02-15T00:00:00Z");
  assert.deepEqual(
    facts.map((f) => f.id).sort(),
    ["f-cache-ttl", "f-db-15", "f-db-16", "f-db-16b", "f-queue-8000"],
  );
  // The March payload change is not believed yet in February.
  assert.ok(!facts.some((f) => f.id === "f-queue-4000"));
});

test("why f-db-15 shows provenance, superseder, and contradiction", (t) => {
  const db = openReadOnly(seededStore(t));
  const result = why(db.connect(), "f-db-15");
  assert.ok(result);
  assert.equal(result.episode.source, "session 2026-02-01T08:00Z");
  assert.deepEqual(result.supersededBy, ["f-db-16"]);
  assert.deepEqual(result.supersedes, []);
  assert.deepEqual(result.contradicts, [{ id: "f-db-16", object: "Postgres 16" }]);
  assert.equal(why(db.connect(), "no-such-fact"), null);
});
