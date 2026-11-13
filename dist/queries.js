/** Normalize a user time to a full ISO timestamp (a bare date means midnight UTC). */
export function normalizeTime(input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input))
        return `${input}T00:00:00Z`;
    return input;
}
/**
 * What did the agent believe at `at`? A fact counts when its validity
 * window covers the time AND it had been recorded by then. Superseded
 * facts are included but marked, so the caller sees the rot, not a
 * cleaned-up history.
 */
export function believedAt(conn, at, subject) {
    const rs = conn.query(`MATCH (f:Fact)
     WHERE coalesce(f.validFrom, '0000-01-01') <= $at
       AND (f.validTo IS NULL OR f.validTo >= $at)
       AND f.createdAt <= $at
       AND ($subject IS NULL OR f.subject = $subject)
     RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate, f.object AS object,
       f.status AS status, f.validFrom AS validFrom, f.validTo AS validTo, f.createdAt AS createdAt
     ORDER BY f.subject, f.predicate, f.id`, { at, subject: subject ?? null }).rows;
    return rs.map((r) => ({
        id: String(r.id),
        subject: String(r.subject),
        predicate: String(r.predicate),
        object: String(r.object),
        status: String(r.status),
        validFrom: r.validFrom == null ? null : String(r.validFrom),
        validTo: r.validTo == null ? null : String(r.validTo),
        createdAt: String(r.createdAt),
    }));
}
/** Full provenance for one fact: its episode, supporters, supersession, contradictions. */
export function why(conn, factId) {
    const facts = conn.query(`MATCH (f:Fact {id: $id})
     RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate, f.object AS object,
       f.status AS status, f.validFrom AS validFrom, f.validTo AS validTo, f.createdAt AS createdAt`, { id: factId }).rows;
    if (facts.length === 0)
        return null;
    const f = facts[0];
    const fact = {
        id: String(f.id),
        subject: String(f.subject),
        predicate: String(f.predicate),
        object: String(f.object),
        status: String(f.status),
        validFrom: f.validFrom == null ? null : String(f.validFrom),
        validTo: f.validTo == null ? null : String(f.validTo),
        createdAt: String(f.createdAt),
    };
    const eps = conn.query(`MATCH (f:Fact {id: $id})-[:FROM_EPISODE]->(ep:Episode)
     RETURN ep.id AS id, ep.source AS source, ep.at AS at, ep.text AS text`, { id: factId }).rows;
    const collect = (cypher) => conn.query(cypher, { id: factId }).rows.map((r) => String(r.id));
    const supporters = collect(`MATCH (f:Fact {id: $id})<-[:SUPPORTS]-(s:Fact) RETURN s.id AS id`);
    const supersededBy = collect(`MATCH (f:Fact {id: $id})<-[:SUPERSEDES]-(n:Fact) RETURN n.id AS id`);
    const supersedes = collect(`MATCH (f:Fact {id: $id})-[:SUPERSEDES]->(o:Fact) RETURN o.id AS id`);
    const contra = conn.query(`MATCH (f:Fact {id: $id}), (g:Fact)
     WHERE g.status = 'current' AND g.subject = f.subject AND g.predicate = f.predicate
       AND g.object <> f.object AND g.id <> f.id
       AND coalesce(f.validFrom, '0000-01-01') < coalesce(g.validTo, '9999-12-31')
       AND coalesce(g.validFrom, '0000-01-01') < coalesce(f.validTo, '9999-12-31')
     RETURN g.id AS id, g.object AS object ORDER BY id`, { id: factId }).rows;
    return {
        fact,
        episode: eps.length === 0 ? null : { id: String(eps[0].id), source: String(eps[0].source), at: String(eps[0].at), text: String(eps[0].text) },
        supporters,
        supersededBy,
        supersedes,
        contradicts: contra.map((r) => ({ id: String(r.id), object: String(r.object) })),
    };
}
