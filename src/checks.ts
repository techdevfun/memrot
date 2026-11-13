/**
 * The seven audit checks. Every check is a Cypher query (or a vector
 * SEARCH) executed inside Relate. memrot only formats the rows and
 * decides the exit code; no graph logic lives in application code.
 *
 * Severity: `error` fails the audit (exit 1). `warning` is reported
 * but does not fail it. The full list is in the README.
 *
 * Dates are ISO-8601 strings (YYYY-MM-DD for validity windows, full
 * UTC timestamps for createdAt). Lexicographic comparison equals
 * chronological comparison for this format, so the queries compare
 * strings directly.
 */
import type { Connection, ParamValue } from "@relate/relate";
import { NEAR_DUP_THRESHOLD, VECTOR_INDEX_NAME } from "./vectors.js";

export type Severity = "error" | "warning";

export interface Finding {
  check: string;
  severity: Severity;
  factId?: string;
  subject?: string;
  predicate?: string;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface CheckResult {
  id: string;
  name: string;
  severity: Severity;
  findings: Finding[];
  /** Set when the check could not run (e.g. no vector index); not a failure. */
  skipped?: string;
}

export interface AuditOptions {
  /** Audit date, YYYY-MM-DD (default: today, UTC). */
  asOf: string;
  /** Facts older than this, with no corroboration, count as stale. */
  staleDays: number;
  /** Cosine threshold for the near-duplicate check. */
  nearDupThreshold: number;
}

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : String(v ?? "");
}

function num(row: Row, key: string): number {
  const v = row[key];
  return typeof v === "number" ? v : Number(v ?? 0);
}

function rows(conn: Connection, cypher: string, params: Record<string, ParamValue> = {}): Row[] {
  return conn.query(cypher, params).rows as Row[];
}

/** YYYY-MM-DD that is `days` before `date`. */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Check 1 - contradiction. Two current facts, same subject + predicate, different object, overlapping validity windows. */
function checkContradiction(conn: Connection): CheckResult {
  const rs = rows(
    conn,
    `MATCH (a:Fact), (b:Fact)
     WHERE a.status = 'current' AND b.status = 'current'
       AND a.subject = b.subject AND a.predicate = b.predicate
       AND a.object <> b.object
       AND coalesce(a.validFrom, '0000-01-01') < coalesce(b.validTo, '9999-12-31')
       AND coalesce(b.validFrom, '0000-01-01') < coalesce(a.validTo, '9999-12-31')
       AND a.id < b.id
     RETURN a.id AS aId, b.id AS bId, a.subject AS subject, a.predicate AS predicate,
       a.object AS aObject, b.object AS bObject,
       a.validFrom AS aFrom, a.validTo AS aTo, b.validFrom AS bFrom, b.validTo AS bTo
     ORDER BY aId, bId`,
  );
  return {
    id: "contradiction",
    name: "Contradictory facts",
    severity: "error",
    findings: rs.map((r) => ({
      check: "contradiction",
      severity: "error" as Severity,
      factId: str(r, "aId"),
      subject: str(r, "subject"),
      predicate: str(r, "predicate"),
      detail:
        `${str(r, "subject")}.${str(r, "predicate")} has two current values in overlapping windows: ` +
        `"${str(r, "aObject")}" (${str(r, "aId")}) and "${str(r, "bObject")}" (${str(r, "bId")}).`,
      evidence: { aId: str(r, "aId"), bId: str(r, "bId"), aObject: str(r, "aObject"), bObject: str(r, "bObject") },
    })),
  };
}

/** Check 2 - superseded-but-served. A fact with an incoming SUPERSEDES edge from another current fact, still marked current. */
function checkSuperseded(conn: Connection): CheckResult {
  const rs = rows(
    conn,
    `MATCH (old:Fact)<-[:SUPERSEDES]-(new:Fact)
     WHERE old.status = 'current' AND new.status = 'current'
     RETURN old.id AS id, new.id AS supersededBy, old.subject AS subject,
       old.predicate AS predicate, old.object AS object
     ORDER BY id`,
  );
  return {
    id: "superseded-served",
    name: "Superseded facts still served",
    severity: "error",
    findings: rs.map((r) => ({
      check: "superseded-served",
      severity: "error" as Severity,
      factId: str(r, "id"),
      subject: str(r, "subject"),
      predicate: str(r, "predicate"),
      detail:
        `${str(r, "subject")}.${str(r, "predicate")} = "${str(r, "object")}" (${str(r, "id")}) ` +
        `was superseded by ${str(r, "supersededBy")} but is still marked current, so it can still be served.`,
      evidence: { supersededBy: str(r, "supersededBy"), object: str(r, "object") },
    })),
  };
}

/** Check 3 - stale. Expired validity, or old with no corroboration and no newer fact on the same subject + predicate. */
function checkStale(conn: Connection, opts: AuditOptions): CheckResult {
  const cutoff = daysBefore(opts.asOf, opts.staleDays);
  const byId = new Map<string, Finding>();

  const expired = rows(
    conn,
    `MATCH (f:Fact)
     WHERE f.status = 'current' AND f.validTo IS NOT NULL AND f.validTo < $asOf
     RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate,
       f.object AS object, f.validTo AS validTo
     ORDER BY id`,
    { asOf: opts.asOf },
  );
  for (const r of expired) {
    byId.set(str(r, "id"), {
      check: "stale",
      severity: "warning",
      factId: str(r, "id"),
      subject: str(r, "subject"),
      predicate: str(r, "predicate"),
      detail:
        `${str(r, "subject")}.${str(r, "predicate")} = "${str(r, "object")}" (${str(r, "id")}) ` +
        `expired on ${str(r, "validTo")} and is still current.`,
      evidence: { reason: "expired", validTo: str(r, "validTo"), object: str(r, "object") },
    });
  }

  const old = rows(
    conn,
    `MATCH (f:Fact)
     WHERE f.status = 'current' AND f.createdAt < $cutoff
       AND NOT (f)<-[:CONFIRMS]-()
       AND NOT EXISTS {
         MATCH (g:Fact)
         WHERE g.subject = f.subject AND g.predicate = f.predicate AND g.createdAt > f.createdAt
       }
     RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate,
       f.object AS object, f.createdAt AS createdAt
     ORDER BY id`,
    { cutoff: `${cutoff}T00:00:00Z` },
  );
  for (const r of old) {
    const id = str(r, "id");
    const prev = byId.get(id);
    if (prev) {
      prev.detail += ` It is also old (recorded ${str(r, "createdAt")}) with no corroboration and no newer fact on the same subject and predicate.`;
      (prev.evidence as Record<string, unknown>).alsoUncorroborated = true;
    } else {
      byId.set(id, {
        check: "stale",
        severity: "warning",
        factId: id,
        subject: str(r, "subject"),
        predicate: str(r, "predicate"),
        detail:
          `${str(r, "subject")}.${str(r, "predicate")} = "${str(r, "object")}" (${id}) ` +
          `was recorded ${str(r, "createdAt")} with no corroboration since and no newer fact on the same subject and predicate.`,
        evidence: { reason: "uncorroborated", createdAt: str(r, "createdAt"), object: str(r, "object") },
      });
    }
  }

  return { id: "stale", name: "Stale facts", severity: "warning", findings: [...byId.values()] };
}

/** Check 4 - orphaned entities. An Entity with no relationships at all. */
function checkOrphaned(conn: Connection): CheckResult {
  const rs = rows(
    conn,
    `MATCH (e:Entity)
     WHERE NOT (e)--()
     RETURN e.id AS id, e.name AS name, e.kind AS kind
     ORDER BY id`,
  );
  return {
    id: "orphaned",
    name: "Orphaned entities",
    severity: "warning",
    findings: rs.map((r) => ({
      check: "orphaned",
      severity: "warning" as Severity,
      subject: str(r, "name"),
      detail: `Entity "${str(r, "name")}" (${str(r, "id")}, kind ${str(r, "kind") || "unknown"}) has no relationships: nothing references it and it references nothing.`,
      evidence: { id: str(r, "id"), kind: str(r, "kind") },
    })),
  };
}

/** Check 5 - provenance-less facts. A Fact with no FROM_EPISODE edge. */
function checkProvenance(conn: Connection): CheckResult {
  const rs = rows(
    conn,
    `MATCH (f:Fact)
     WHERE NOT (f)-[:FROM_EPISODE]->()
     RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate, f.object AS object
     ORDER BY id`,
  );
  return {
    id: "provenance-less",
    name: "Provenance-less facts",
    severity: "error",
    findings: rs.map((r) => ({
      check: "provenance-less",
      severity: "error" as Severity,
      factId: str(r, "id"),
      subject: str(r, "subject"),
      predicate: str(r, "predicate"),
      detail:
        `${str(r, "subject")}.${str(r, "predicate")} = "${str(r, "object")}" (${str(r, "id")}) ` +
        `has no episode: there is no record of where this fact came from.`,
      evidence: { object: str(r, "object") },
    })),
  };
}

/** Check 6 - validity-order violations. validFrom after validTo, or a superseder created before the fact it supersedes. */
function checkValidityOrder(conn: Connection): CheckResult {
  const findings: Finding[] = [];
  const inverted = rows(
    conn,
    `MATCH (f:Fact)
     WHERE f.validFrom IS NOT NULL AND f.validTo IS NOT NULL AND f.validFrom > f.validTo
     RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate,
       f.object AS object, f.validFrom AS validFrom, f.validTo AS validTo
     ORDER BY id`,
  );
  for (const r of inverted) {
    findings.push({
      check: "validity-order",
      severity: "error",
      factId: str(r, "id"),
      subject: str(r, "subject"),
      predicate: str(r, "predicate"),
      detail:
        `${str(r, "subject")}.${str(r, "predicate")} = "${str(r, "object")}" (${str(r, "id")}) ` +
        `has validFrom ${str(r, "validFrom")} after validTo ${str(r, "validTo")}: the validity window is empty.`,
      evidence: { reason: "empty-window", validFrom: str(r, "validFrom"), validTo: str(r, "validTo") },
    });
  }
  const badOrder = rows(
    conn,
    `MATCH (old:Fact)<-[:SUPERSEDES]-(new:Fact)
     WHERE new.createdAt < old.createdAt
     RETURN old.id AS id, new.id AS supersededBy, old.subject AS subject,
       old.predicate AS predicate, old.createdAt AS oldCreated, new.createdAt AS newCreated
     ORDER BY id`,
  );
  for (const r of badOrder) {
    findings.push({
      check: "validity-order",
      severity: "error",
      factId: str(r, "id"),
      subject: str(r, "subject"),
      predicate: str(r, "predicate"),
      detail:
        `${str(r, "supersededBy")} supersedes ${str(r, "id")} but was created ${str(r, "newCreated")}, ` +
        `before ${str(r, "id")} was created ${str(r, "oldCreated")}: a fact cannot be replaced before it exists.`,
      evidence: { reason: "superseder-before-superseded", supersededBy: str(r, "supersededBy") },
    });
  }
  return { id: "validity-order", name: "Validity-order violations", severity: "error", findings };
}

/** Does the store have the vector index check 7 needs? A missing index is not an error: the check falls back to a cosine scan. */
function hasVectorIndex(conn: Connection): boolean {
  try {
    const rs = rows(conn, `SHOW INDEXES YIELD name WHERE name = $name RETURN name`, { name: VECTOR_INDEX_NAME });
    return rs.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check 7 - near-duplicate facts (lexical, vector-backed).
 * Two facts whose trigram embeddings score at or above the threshold
 * are the same claim restated. Pairs that are already contradictions
 * (same subject AND same predicate) are excluded: check 1 owns those.
 * The similarity ranking is done by the Relate engine in both paths:
 * index SEARCH when the vector index exists, vector.similarity.cosine
 * scan otherwise.
 */
function checkNearDuplicates(conn: Connection, opts: AuditOptions): CheckResult {
  const threshold = opts.nearDupThreshold;
  const findings: Finding[] = [];
  const seen = new Set<string>();

  // A store whose facts carry no embeddings cannot be checked for
  // near-duplicates at all: say so instead of reporting "none found".
  const withEmbedding = rows(conn, `MATCH (f:Fact) WHERE f.embedding IS NOT NULL RETURN count(f) AS n`);
  if (num(withEmbedding[0] ?? {}, "n") === 0) {
    return {
      id: "near-duplicate",
      name: "Near-duplicate facts (lexical)",
      severity: "warning",
      findings: [],
      skipped: "no embeddings on Fact nodes: near-duplicate check could not run (see memrot index, v1.1)",
    };
  }

  const push = (aId: string, bId: string, score: number, a: Row, b: Row) => {
    const key = [aId, bId].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      check: "near-duplicate",
      severity: "warning",
      factId: aId,
      subject: str(a, "subject"),
      predicate: str(a, "predicate"),
      detail:
        `${str(a, "subject")}.${str(a, "predicate")} = "${str(a, "object")}" (${aId}) and ` +
        `${str(b, "subject")}.${str(b, "predicate")} = "${str(b, "object")}" (${bId}) ` +
        `are near-duplicates (lexical cosine ${score.toFixed(2)}): the same claim recorded twice under different wording.`,
      evidence: { aId, bId, score: Number(score.toFixed(3)), aObject: str(a, "object"), bObject: str(b, "object") },
    });
  };

  if (hasVectorIndex(conn)) {
    const facts = rows(
      conn,
      `MATCH (f:Fact) WHERE f.embedding IS NOT NULL
       RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate, f.object AS object, f.embedding AS embedding
       ORDER BY id`,
    );
    for (const f of facts) {
      const hits = rows(
        conn,
        `MATCH (g:Fact) SEARCH g IN (VECTOR INDEX ${VECTOR_INDEX_NAME} FOR $q LIMIT 4) SCORE AS score
         RETURN g.id AS id, g.subject AS subject, g.predicate AS predicate, g.object AS object, score`,
        { q: f.embedding as ParamValue },
      );
      for (const g of hits) {
        const otherId = str(g, "id");
        if (otherId === str(f, "id")) continue;
        if (num(g, "score") < threshold) continue;
        if (str(g, "subject") === str(f, "subject") && str(g, "predicate") === str(f, "predicate")) continue;
        const [a, b] = str(f, "id") < otherId ? [f, g] : [g, f];
        push(str(a, "id"), str(b, "id"), num(g, "score"), a, b);
      }
    }
  } else {
    const pairs = rows(
      conn,
      `MATCH (a:Fact), (b:Fact)
       WHERE a.id < b.id
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND NOT (a.subject = b.subject AND a.predicate = b.predicate)
         AND vector.similarity.cosine(a.embedding, b.embedding) >= $threshold
       RETURN a.id AS aId, b.id AS bId, a.subject AS aSubject, a.predicate AS aPredicate,
         a.object AS aObject, b.subject AS bSubject, b.predicate AS bPredicate, b.object AS bObject,
         vector.similarity.cosine(a.embedding, b.embedding) AS score
       ORDER BY score DESC`,
      { threshold },
    );
    for (const p of pairs) {
      const a: Row = { subject: str(p, "aSubject"), predicate: str(p, "aPredicate"), object: str(p, "aObject") };
      const b: Row = { subject: str(p, "bSubject"), predicate: str(p, "bPredicate"), object: str(p, "bObject") };
      push(str(p, "aId"), str(p, "bId"), num(p, "score"), a, b);
    }
  }

  findings.sort((x, y) => String(x.evidence.aId).localeCompare(String(y.evidence.aId)));
  return { id: "near-duplicate", name: "Near-duplicate facts (lexical)", severity: "warning", findings };
}

/** Run all seven checks. */
export function runAllChecks(conn: Connection, opts: AuditOptions): CheckResult[] {
  return [
    checkContradiction(conn),
    checkSuperseded(conn),
    checkStale(conn, opts),
    checkOrphaned(conn),
    checkProvenance(conn),
    checkValidityOrder(conn),
    checkNearDuplicates(conn, opts),
  ];
}

export const DEFAULT_OPTIONS: AuditOptions = {
  asOf: new Date().toISOString().slice(0, 10),
  staleDays: 90,
  nearDupThreshold: NEAR_DUP_THRESHOLD,
};
