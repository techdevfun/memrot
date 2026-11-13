/**
 * Build the seeded demo memory: a small, deliberately dirty agent
 * memory about a fictional migration, with KNOWN ground truth.
 * Every check is evaluated against this fixture in the test suite.
 *
 * The graph itself lives in examples/seed.cypher (plain Cypher, one
 * statement per line). This module executes it, then backfills the
 * trigram embedding on every Fact and creates the vector index.
 * `memrot seed` runs the same builder, so the shipped examples/demo.rl
 * and a fresh `memrot seed` produce the same audit result.
 */
import { readFileSync } from "node:fs";
import { EMBEDDING_DIM, VECTOR_INDEX_NAME, factText, trigramVector } from "./vectors.js";
import { openWritable } from "./store.js";
export const SEED_CYPHER_URL = new URL("../examples/seed.cypher", import.meta.url);
/** The planted faults, for the README and the tests. Keep in sync with seed.cypher. */
export const SEED_GROUND_TRUTH = {
    contradiction: [
        ["f-queue-8000", "f-queue-4000"],
        ["f-db-15", "f-db-16"],
    ],
    supersededServed: ["f-db-15"],
    stale: ["f-cache-ttl", "f-feature-flag"],
    orphaned: ["e-legacycron"],
    provenanceLess: ["f-deploy-region"],
    validityOrder: ["f-feature-flag"],
    nearDuplicate: [["f-db-16", "f-db-16b"]],
    believedAt2026_02_15: ["f-queue-8000", "f-db-15", "f-db-16", "f-db-16b", "f-cache-ttl"],
};
export function loadSeedCypher() {
    return readFileSync(SEED_CYPHER_URL, "utf8");
}
/** Execute the seed statements against an open writable database. */
export function applySeed(db, cypher) {
    const conn = db.connect();
    const noComments = cypher
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
    const statements = noComments
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    for (const stmt of statements) {
        conn.query(stmt.endsWith(";") ? stmt : `${stmt};`);
    }
    conn.query(`CREATE VECTOR INDEX ${VECTOR_INDEX_NAME} IF NOT EXISTS FOR (f:Fact) ON (f.embedding) ` +
        "OPTIONS {indexConfig: {`vector.dimensions`: 64, `vector.similarity_function`: 'cosine'}}");
    const facts = conn.query("MATCH (f:Fact) RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate, f.object AS object").rows;
    for (const f of facts) {
        const v = trigramVector(factText(f.subject, f.predicate, f.object), EMBEDDING_DIM);
        conn.query("MATCH (f:Fact {id: $id}) SET f.embedding = $v", { id: f.id, v });
    }
    db.checkpoint();
}
/** Create a new store at `path` and seed it. Refuses to overwrite. */
export function buildSeededStore(path) {
    const db = openWritable(path);
    applySeed(db, loadSeedCypher());
}
