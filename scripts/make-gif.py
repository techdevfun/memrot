#!/usr/bin/env python3
"""Render demo/transcript.txt as a terminal-typing GIF.

The transcript is generated from real CLI runs (scripts/capture-demo.sh);
this script only renders it, never edits the content.

Frames are written as PNGs to a temp dir and encoded with ffmpeg
(streaming, low memory) instead of holding every frame in RAM.
"""
from PIL import Image, ImageDraw, ImageFont
import os
import shutil
import subprocess
import sys
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FRAMES_DIR = "/tmp/memrot-gif-frames"

W = 1240
BG = (18, 18, 24)
FG = (220, 220, 220)
DIM = (150, 150, 160)
GREEN = (120, 220, 130)
YELLOW = (235, 200, 100)
RED = (240, 110, 110)
CYAN = (120, 200, 230)

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 12)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 12)
LINE_H = 16

lines = open(os.path.join(ROOT, "demo", "transcript.txt")).read().splitlines()
# Wrap long lines for display only (the transcript is unchanged):
# at 12pt DejaVuSansMono the 1240px canvas fits ~167 chars per line.
wrapped = []
for ln in lines:
    if len(ln) <= 165:
        wrapped.append(ln)
    else:
        wrapped.extend(textwrap.wrap(ln, width=165, subsequent_indent="  ", break_on_hyphens=False))
lines = wrapped
# Fixed-height scrolling terminal viewport: show the last VIEW_LINES
# lines like a real terminal scrolling; content is unchanged.
VIEW_LINES = 38
H = 14 + VIEW_LINES * LINE_H + 44

def color_for(line: str):
    if line.startswith("$"):
        return GREEN
    if line.startswith("#"):
        return DIM
    if "ERROR" in line:
        return RED
    if "WARN" in line:
        return YELLOW
    if line.startswith("audit: FAILED"):
        return RED
    if line.startswith("audit: clean"):
        return GREEN
    if line.startswith("exit: 1"):
        return RED
    if line.startswith("exit: 0"):
        return GREEN
    if "fact(s) believed" in line:
        return CYAN
    return FG

shutil.rmtree(FRAMES_DIR, ignore_errors=True)
os.makedirs(FRAMES_DIR)

def render(canvas_tmp):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 14
    for text, color in canvas_tmp[-VIEW_LINES:]:
        f = bold if text.startswith("$") else font
        d.text((14, y), text, font=f, fill=color)
        y += LINE_H
        if y > H - 30:
            break
    d.rectangle([14, H - 24, 22, H - 12], fill=GREEN)
    return img

n = 0
def save(img):
    global n
    n += 1
    img.save(os.path.join(FRAMES_DIR, f"frame{n:04d}.png"))

# Title card (2.5s at 20 fps).
title = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(title)
d.text((14, 120), "memrot - audit an AI agent's memory, read-only", font=bold, fill=GREEN)
d.text((14, 170), "1. seed demo.rl: a dirty memory, 7 planted faults", font=font, fill=FG)
d.text((14, 200), "2. audit: 9 findings, 5 errors - exit 1", font=font, fill=FG)
d.text((14, 230), "3. believed-at 2026-02-15: what the agent believed then", font=font, fill=FG)
d.text((14, 260), "4. why f-db-15: provenance, superseder, contradiction", font=font, fill=FG)
d.text((14, 360), "read-only CLI - offline, no LLM, no server", font=font, fill=DIM)
d.text((14, 390), "synthetic fixture, real CLI output", font=font, fill=DIM)
for _ in range(50):
    save(title.copy())

canvas = []
for line in lines:
    color = color_for(line)
    # Two typing steps per line + one hold: ~3 frames/line keeps the
    # total near 30 s at 20 fps without holding frames in memory.
    half = line[: max(1, len(line) // 2)]
    save(render(canvas + [(half, color)]))
    save(render(canvas + [(line, color)]))
    canvas.append((line, color))
    save(render(canvas))

out = os.path.join(ROOT, "demo", "memrot-demo.gif")
cmd = [
    "ffmpeg", "-y", "-v", "error",
    "-framerate", "20", "-i", os.path.join(FRAMES_DIR, "frame%04d.png"),
    "-vf", "split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse",
    out,
]
res = subprocess.run(cmd)
if res.returncode != 0:
    print("ffmpeg failed", file=sys.stderr)
    sys.exit(1)
shutil.rmtree(FRAMES_DIR, ignore_errors=True)
size = os.path.getsize(out)
print(f"GIF written: {out} ({n} frames, {n * 50 / 1000:.1f}s, {size} bytes)")
