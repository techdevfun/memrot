# memrot demo seed: a small, deliberately dirty agent memory about a
# fictional migration. Every planted fault is listed in src/seed.ts
# (SEED_GROUND_TRUTH) and asserted by the test suite.
#
# Story: an agent helped migrate a service. It recorded the queue
# payload limit twice with different values, recorded the DB upgrade
# without marking the old engine superseded, let a cache TTL expire,
# lost the provenance of the deploy region, wrote an empty validity
# window for a feature flag, recorded the DB engine twice under
# different predicate spellings, and kept an entity nothing references.
# Three facts are clean controls and must NOT be flagged.

# Entities
CREATE (:Entity {id: 'e-queue', name: 'Queue', kind: 'service'});
CREATE (:Entity {id: 'e-database', name: 'Database', kind: 'service'});
CREATE (:Entity {id: 'e-cache', name: 'Cache', kind: 'service'});
CREATE (:Entity {id: 'e-deploy', name: 'Deploy', kind: 'process'});
CREATE (:Entity {id: 'e-feature', name: 'FeatureFlag', kind: 'setting'});
CREATE (:Entity {id: 'e-legacycron', name: 'LegacyCron', kind: 'service'});

# Episodes (one agent turn each; source is where the fact came from)
CREATE (:Episode {id: 'ep0', source: 'session 2026-02-01T08:00Z', at: '2026-02-01T08:30:00Z', text: 'DB still on Postgres 15'});
CREATE (:Episode {id: 'ep1', source: 'session 2026-01-05T09:12Z', at: '2026-01-05T10:00:00Z', text: 'ADR-014: queue payload limit set to 8000 bytes'});
CREATE (:Episode {id: 'ep2', source: 'session 2026-03-01T14:20Z', at: '2026-03-01T15:00:00Z', text: 'Queue payload limit lowered to 4000 bytes after OOM'});
CREATE (:Episode {id: 'ep3', source: 'session 2026-02-10T11:00Z', at: '2026-02-10T11:30:00Z', text: 'DB upgraded to Postgres 16'});
CREATE (:Episode {id: 'ep4', source: 'session 2026-06-01T08:00Z', at: '2026-06-01T08:30:00Z', text: 'Cache TTL review'});
CREATE (:Episode {id: 'ep5', source: 'session 2026-09-20T16:00Z', at: '2026-09-20T16:30:00Z', text: 'Deploy region and replicas confirmed; queue limit re-confirmed'});
CREATE (:Episode {id: 'ep6', source: 'session 2026-10-02T09:00Z', at: '2026-10-02T09:30:00Z', text: 'Feature flag review; DB engine re-confirmed'});
CREATE (:Episode {id: 'ep7', source: 'session 2026-05-02T09:00Z', at: '2026-05-02T09:30:00Z', text: 'Feature flag review'});

# Facts: the contradiction pair (queue payload limit, two current values)
CREATE (:Fact {id: 'f-queue-8000', subject: 'queue', predicate: 'max_payload', object: '8000 bytes', validFrom: '2026-01-01', validTo: null, createdAt: '2026-01-05T10:00:00Z', status: 'current'});
CREATE (:Fact {id: 'f-queue-4000', subject: 'queue', predicate: 'max_payload', object: '4000 bytes', validFrom: '2026-03-01', validTo: null, createdAt: '2026-03-01T15:00:00Z', status: 'current'});

# Facts: the DB engine (old value superseded in words, still current in status)
CREATE (:Fact {id: 'f-db-15', subject: 'database', predicate: 'engine', object: 'Postgres 15', validFrom: '2026-01-01', validTo: null, createdAt: '2026-02-01T08:30:00Z', status: 'current'});
CREATE (:Fact {id: 'f-db-16', subject: 'database', predicate: 'engine', object: 'Postgres 16', validFrom: '2026-02-10', validTo: null, createdAt: '2026-02-10T11:30:00Z', status: 'current'});
CREATE (:Fact {id: 'f-db-16b', subject: 'database', predicate: 'db_engine', object: 'PostgreSQL 16', validFrom: '2026-02-10', validTo: null, createdAt: '2026-02-11T09:00:00Z', status: 'current'});

# Facts: stale (expired TTL), provenance-less (deploy region), empty window (flag)
CREATE (:Fact {id: 'f-cache-ttl', subject: 'cache', predicate: 'ttl', object: '300s', validFrom: '2026-01-01', validTo: '2026-06-01', createdAt: '2026-01-05T10:00:00Z', status: 'current'});
CREATE (:Fact {id: 'f-deploy-region', subject: 'deploy', predicate: 'region', object: 'eu-west-1', validFrom: '2026-01-01', validTo: null, createdAt: '2026-10-15T09:00:00Z', status: 'current'});
CREATE (:Fact {id: 'f-feature-flag', subject: 'feature', predicate: 'flag', object: 'on', validFrom: '2026-05-01', validTo: '2026-04-01', createdAt: '2026-05-02T09:30:00Z', status: 'current'});

# Facts: clean controls (recent, corroborated where needed, with provenance)
CREATE (:Fact {id: 'f-deploy-replicas', subject: 'deploy', predicate: 'replicas', object: '3', validFrom: '2026-09-01', validTo: null, createdAt: '2026-09-20T16:30:00Z', status: 'current'});
CREATE (:Fact {id: 'f-feature-darkmode', subject: 'feature', predicate: 'dark_mode', object: 'enabled', validFrom: '2026-10-01', validTo: null, createdAt: '2026-10-02T09:30:00Z', status: 'current'});
CREATE (:Fact {id: 'f-cache-backend', subject: 'cache', predicate: 'backend', object: 'redis', validFrom: '2026-09-01', validTo: null, createdAt: '2026-09-20T16:30:00Z', status: 'current'});

# Fact -> Entity
MATCH (f:Fact {id: 'f-queue-8000'}), (e:Entity {id: 'e-queue'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-queue-4000'}), (e:Entity {id: 'e-queue'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-db-15'}), (e:Entity {id: 'e-database'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-db-16'}), (e:Entity {id: 'e-database'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-db-16b'}), (e:Entity {id: 'e-database'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-cache-ttl'}), (e:Entity {id: 'e-cache'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-cache-backend'}), (e:Entity {id: 'e-cache'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-deploy-region'}), (e:Entity {id: 'e-deploy'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-deploy-replicas'}), (e:Entity {id: 'e-deploy'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-feature-flag'}), (e:Entity {id: 'e-feature'}) CREATE (f)-[:ABOUT]->(e);
MATCH (f:Fact {id: 'f-feature-darkmode'}), (e:Entity {id: 'e-feature'}) CREATE (f)-[:ABOUT]->(e);

# Fact -> Episode (provenance). f-deploy-region deliberately has none.
MATCH (f:Fact {id: 'f-queue-8000'}), (ep:Episode {id: 'ep1'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-queue-4000'}), (ep:Episode {id: 'ep2'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-db-15'}), (ep:Episode {id: 'ep0'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-db-16'}), (ep:Episode {id: 'ep3'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-db-16b'}), (ep:Episode {id: 'ep3'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-cache-ttl'}), (ep:Episode {id: 'ep4'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-cache-backend'}), (ep:Episode {id: 'ep5'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-deploy-replicas'}), (ep:Episode {id: 'ep5'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-feature-flag'}), (ep:Episode {id: 'ep7'}) CREATE (f)-[:FROM_EPISODE]->(ep);
MATCH (f:Fact {id: 'f-feature-darkmode'}), (ep:Episode {id: 'ep6'}) CREATE (f)-[:FROM_EPISODE]->(ep);

# Supersession: Postgres 16 replaces Postgres 15 (but 15 stays current)
MATCH (n:Fact {id: 'f-db-16'}), (o:Fact {id: 'f-db-15'}) CREATE (n)-[:SUPERSEDES]->(o);

# Corroboration: later episodes re-confirmed these facts, so they are not stale
MATCH (ep:Episode {id: 'ep5'}), (f:Fact {id: 'f-queue-4000'}) CREATE (ep)-[:CONFIRMS]->(f);
MATCH (ep:Episode {id: 'ep6'}), (f:Fact {id: 'f-db-16'}) CREATE (ep)-[:CONFIRMS]->(f);
MATCH (ep:Episode {id: 'ep6'}), (f:Fact {id: 'f-db-16b'}) CREATE (ep)-[:CONFIRMS]->(f);
