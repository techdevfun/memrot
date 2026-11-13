/**
 * CLI exit codes and store-error behavior, via spawned processes.
 * Exit codes: 0 clean/done, 1 audit found errors, 2 usage/store error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(args, cwd) {
  try {
    const out = execFileSync("node", [CLI, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), "memrot-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Spawn a child that opens `store` writable and holds the lock. Resolves when ready. */
function holdWriter(store, dir) {
  // Absolute import: the holder lives in a temp dir, so a bare
  // "@relate/relate" specifier would not resolve from there.
  const relateEntry = fileURLToPath(new URL("../node_modules/@relate/relate/index.js", import.meta.url));
  const holder = join(dir, "holder.mjs");
  writeFileSync(
    holder,
    `import { Database } from ${JSON.stringify(relateEntry)};\n` +
      `const db = Database.open(process.argv[2]);\n` +
      `db.checkpoint();\n` +
      `process.stdout.write("ready\\n");\n` +
      `setTimeout(() => {}, 30000);\n`,
  );
  const child = spawn("node", [holder, store], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    child.stdout.once("data", () => resolve(child));
    child.stderr.once("data", (d) => reject(new Error(`holder failed: ${d}`)));
    child.once("error", reject);
  });
}

test("audit exit codes: dirty store 1, clean JSON 0", (t) => {
  const dir = tmp(t);
  const seeded = join(dir, "demo.rl");
  assert.equal(run(["seed", seeded]).status, 0);
  const dirty = run(["audit", seeded, "--as-of", "2026-11-13"]);
  assert.equal(dirty.status, 1, dirty.stdout + dirty.stderr);
  assert.match(dirty.stdout, /9 finding\(s\): 5 error\(s\), 4 warning\(s\)/);
  assert.match(dirty.stdout, /audit: FAILED \(exit 1\)/);

  const clean = join(dir, "clean.rl");
  assert.equal(run(["seed", clean]).status, 0);
  // A seeded store is dirty by design; verify JSON shape on the same run.
  const json = run(["audit", seeded, "--as-of", "2026-11-13", "--format", "json"]);
  assert.equal(json.status, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.tool, "memrot");
  assert.equal(report.summary.total, 9);
  assert.equal(report.summary.failed, true);
  assert.equal(report.checks.length, 7);
});

test("seed refuses to overwrite; missing store and bad usage exit 2", (t) => {
  const dir = tmp(t);
  const seeded = join(dir, "demo.rl");
  assert.equal(run(["seed", seeded]).status, 0);
  const again = run(["seed", seeded]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already exists/);

  const missing = run(["audit", join(dir, "nope.rl")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such store/);

  assert.equal(run(["audit"]).status, 2);
  assert.equal(run(["frobnicate"]).status, 2);
  assert.equal(run(["audit", seeded, "--format", "yaml"]).status, 2);
});

test("believed-at and why via CLI", (t) => {
  const dir = tmp(t);
  const seeded = join(dir, "demo.rl");
  assert.equal(run(["seed", seeded]).status, 0);
  const b = run(["believed-at", seeded, "--at", "2026-02-15"]);
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /5 fact\(s\) believed at 2026-02-15/);
  assert.match(b.stdout, /f-queue-8000/);
  assert.doesNotMatch(b.stdout, /f-queue-4000/);

  const w = run(["why", seeded, "f-db-15"]);
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, /superseded by: f-db-16/);
  assert.match(w.stdout, /f-db-16: "Postgres 16"/);

  const missing = run(["why", seeded, "no-such-fact"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no fact with id/);
});

test("locked .rl store: audit exits 2 with the clone remedy", async (t) => {
  const dir = tmp(t);
  const seeded = join(dir, "demo.rl");
  assert.equal(run(["seed", seeded]).status, 0);
  const child = await holdWriter(seeded, dir);
  try {
    const r = run(["audit", seeded, "--as-of", "2026-11-13"]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /writer lock/i);
    assert.match(r.stderr, /relate clone/);
  } finally {
    child.kill();
  }
});

test("directory store: audit works beside a live writer", async (t) => {
  const dir = tmp(t);
  const store = join(dir, "dirstore");
  assert.equal(run(["seed", store]).status, 0);
  const child = await holdWriter(store, dir);
  try {
    const r = run(["audit", store, "--as-of", "2026-11-13"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /9 finding\(s\): 5 error\(s\), 4 warning\(s\)/);
  } finally {
    child.kill();
  }
});
