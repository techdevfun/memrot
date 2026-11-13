/**
 * Opening a Relate store, read-only, with human errors.
 *
 * memrot NEVER writes to the store under audit. It opens with
 * `{ readOnly: true }`, which refuses writes and checkpoints and does
 * not create a missing store.
 *
 * The lock rule (verified live against @relate/relate 1.0.1): a `.rl`
 * file held by a writer cannot be opened read-only, and `relate clone`
 * cannot copy it either - both fail with an opaque "internal error".
 * memrot catches that and prints the remedy instead of the raw error:
 * stop the writer first, or clone after it exits, or use a directory
 * store, which CAN be opened read-only beside a live writer.
 */
import { existsSync } from "node:fs";
import { Database } from "@relate/relate";

export class StoreError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

/** Open a store read-only. Throws StoreError with a human message. */
export function openReadOnly(path: string): Database {
  if (!existsSync(path)) {
    throw new StoreError(
      `no such store: ${path}\n` +
        `  Check the path. To try the audit on a sample memory, run:\n` +
        `    memrot seed demo.rl && memrot audit demo.rl`,
    );
  }
  try {
    return Database.open(path, { readOnly: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new StoreError(
      `cannot open store (read-only): ${path}\n` +
        `  Relate says: ${raw}\n` +
        `  The usual cause is a writer lock: a .rl file held by a running\n` +
        `  agent cannot be opened read-only, and it cannot be cloned either.\n` +
        `  Fix one of these, then audit again:\n` +
        `    1. Stop the agent (release the writer), then run memrot audit.\n` +
        `    2. After the writer exits, snapshot it first:\n` +
        `         relate clone ${path} snapshot.rl && memrot audit snapshot.rl\n` +
        `    3. Use a directory store instead of a single .rl file: a\n` +
        `       directory store CAN be opened read-only beside a live writer.`,
    );
  }
}

/** Open a store for writing (used only by `memrot seed`). */
export function openWritable(path: string): Database {
  return Database.open(path);
}
