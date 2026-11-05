"""Turns the frames from record.mjs into an optimized GIF with one shared palette. Needs Pillow."""
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

out = Path(sys.argv[1])
width = int(sys.argv[2]) if len(sys.argv) > 2 else 880
frames = json.loads((Path(tempfile.gettempdir()) / "blackout-demo" / "frames.json").read_text())

images, durations = [], []
for f in frames:
    im = Image.open(f["file"]).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    if images and ImageChops.difference(images[-1], im).getbbox() is None:
        durations[-1] += f["ms"]
        continue
    images.append(im)
    durations.append(f["ms"])

# One palette from the frames with the most colour, so colours don't flicker between frames.
sheet = Image.new("RGB", (width, images[0].height * 3))
for i, idx in enumerate([0, len(images) // 2, len(images) - 1]):
    sheet.paste(images[idx], (0, i * images[0].height))
palette = sheet.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.NONE)
quantized = [im.quantize(palette=palette, dither=Image.NONE) for im in images]

out.parent.mkdir(parents=True, exist_ok=True)
quantized[0].save(out, save_all=True, append_images=quantized[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f"{out}: {len(quantized)} frames, {sum(durations) / 1000:.1f}s, {out.stat().st_size / 1024 / 1024:.2f} MB")
