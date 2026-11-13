#!/usr/bin/env node
/**
 * Rebuild examples/demo.rl from examples/seed.cypher (via dist/seed.js).
 * Usage: node scripts/build-demo-store.js [output-path]
 * Default output is examples/demo.rl. Refuses to overwrite unless
 * --force is passed, so a stray run never clobbers the committed file.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeededStore } from "../dist/seed.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const force = args.includes("--force");
const out = args.find((a) => !a.startsWith("--")) ?? join(root, "examples", "demo.rl");

if (existsSync(out) && !force) {
  console.error(`refusing to overwrite ${out} (pass --force)`);
  process.exit(2);
}
if (existsSync(out)) rmSync(out, { force: true });
buildSeededStore(out);
console.log(`built ${out}`);
