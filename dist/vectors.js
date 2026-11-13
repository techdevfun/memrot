/**
 * Lexical embedding for Fact nodes: character-trigram feature hashing.
 *
 * No model, no network, no API key. The vector is a deterministic
 * fingerprint of the fact's text (subject + predicate + object), hashed
 * into a fixed-width space and unit-normalized so cosine similarity is
 * meaningful. It catches restatements ("Postgres 16" vs "PostgreSQL 16")
 * and copy-paste duplicates. It does NOT catch semantic paraphrase
 * ("the queue is Postgres" vs "we moved off Postgres") - that needs a
 * real embedder and is explicitly out of scope for v1 (see README).
 *
 * The similarity itself is computed inside Relate (vector index SEARCH
 * or vector.similarity.cosine), never in this module.
 */
export const EMBEDDING_DIM = 64;
export const VECTOR_INDEX_NAME = "fact_embedding_idx";
/**
 * Default near-duplicate threshold, on Relate's similarity scale.
 * Relate reports cosine similarity on a 0-1 scale where 0.5 means
 * orthogonal and 1.0 means identical, so this is NOT a raw cosine:
 * 0.91 here equals a raw cosine of about 0.82. The seeded fixture
 * scores 0.925 for its intended near-duplicate pair and 0.896 for
 * the next-closest pair, so 0.91 sits between them with margin both
 * ways. Tune it per store with --near-dup-threshold.
 */
export const NEAR_DUP_THRESHOLD = 0.91;
/** Deterministic trigram vector of `text`, unit-normalized. */
export function trigramVector(text, dim = EMBEDDING_DIM) {
    const v = new Array(dim).fill(0);
    const t = ` ${text.toLowerCase()} `;
    for (let i = 0; i < t.length - 2; i++) {
        let h = 0;
        for (let k = 0; k < 3; k++)
            h = (h * 31 + t.charCodeAt(i + k)) >>> 0;
        v[h % dim] += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
}
/** The text a Fact's embedding is computed from. */
export function factText(subject, predicate, object) {
    return `${subject} ${predicate} ${object}`;
}
/** Cosine similarity between two unit-normalized vectors (JS side, tests only). */
export function cosine(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += a[i] * b[i];
    return s;
}
