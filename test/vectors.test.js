/** Unit tests for the lexical trigram embedding (JS side only). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, factText, trigramVector } from "../dist/vectors.js";

test("trigramVector is deterministic and unit-normalized", () => {
  const a = trigramVector("database engine postgres 16");
  const b = trigramVector("database engine postgres 16");
  assert.deepEqual(a, b);
  assert.equal(a.length, 64);
  const norm = Math.hypot(...a);
  assert.ok(Math.abs(norm - 1) < 1e-9, `norm ${norm} should be 1`);
});

test("known similarities (raw cosine, JS scale)", () => {
  const sim = (x, y) => cosine(trigramVector(factText(...x)), trigramVector(factText(...y)));
  // The intended near-duplicate pair: same claim, different spelling.
  const dbPair = sim(["database", "engine", "Postgres 16"], ["database", "db_engine", "PostgreSQL 16"]);
  assert.ok(dbPair > 0.84 && dbPair < 0.87, `db pair ${dbPair}`);
  // The contradiction pair is textually near-identical (different number only).
  const qPair = sim(["queue", "max_payload", "8000 bytes"], ["queue", "max_payload", "4000 bytes"]);
  assert.ok(qPair > 0.94, `queue pair ${qPair}`);
  // Unrelated facts stay far apart.
  const far = sim(["cache", "ttl", "300s"], ["cache", "backend", "redis"]);
  assert.ok(far < 0.4, `cache pair ${far}`);
  const cross = sim(["queue", "max_payload", "8000 bytes"], ["database", "engine", "Postgres 16"]);
  assert.ok(cross < 0.4, `cross pair ${cross}`);
});

test("factText joins subject, predicate, object", () => {
  assert.equal(factText("database", "engine", "Postgres 16"), "database engine Postgres 16");
});
