#!/usr/bin/env bash
# Capture the demo transcript from the REAL CLI (no hand-edited output).
# Runs in a scratch dir so nothing pollutes the repo. The transcript is
# rendered to demo/memrot-demo.gif by scripts/make-gif.py.
#
# The fixture is SYNTHETIC (a fictional migration memory); its findings
# are the fixture's own, asserted by the test suite.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH=/tmp/memrot-demo
BIN="$SCRATCH/bin"
rm -rf "$SCRATCH"
mkdir -p "$BIN" "$ROOT/demo"
ln -sf "$ROOT/dist/cli.js" "$BIN/memrot"
chmod +x "$ROOT/dist/cli.js"
export PATH="$BIN:$PATH"

WORK="$SCRATCH/work"
mkdir -p "$WORK"
cd "$WORK"

OUT="$ROOT/demo/transcript.txt"
{
  echo "# memrot demo - real CLI output on the SYNTHETIC fixture"
  echo "# (examples/demo.rl: a fictional migration memory with 7 planted"
  echo "#  faults and 3 clean controls. Findings are the fixture's own.)"
  echo ""
  echo "\$ memrot seed demo.rl"
  memrot seed demo.rl
  echo ""
  echo "\$ memrot audit demo.rl --as-of 2026-11-13"
  memrot audit demo.rl --as-of 2026-11-13 || echo "exit: $?"
  echo ""
  echo "\$ memrot believed-at demo.rl --at 2026-02-15"
  memrot believed-at demo.rl --at 2026-02-15
  echo ""
  echo "\$ memrot why demo.rl f-db-15"
  memrot why demo.rl f-db-15
} > "$OUT" 2>&1
echo "transcript written: $OUT ($(wc -l < "$OUT") lines)"
