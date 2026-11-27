"""Render every frame of the 22s loop to vader_frames/ (half-res JPEGs).

Run once:  py -3 vader_frames.py
Then open vader_player.html in a browser for the interactive player.
"""
import os

from PIL import Image

import clownfish

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vader_frames")
os.makedirs(OUT, exist_ok=True)

N = int(clownfish.LOOP * clownfish.FPS)
print(f"Rendering {N} frames ({clownfish.LOOP:.0f}s @ {clownfish.FPS}fps) -> {OUT}")
for i in range(N):
    img = clownfish.frame(i / clownfish.FPS, code=False)
    img = img.resize((clownfish.W // 2, clownfish.H // 2), Image.BOX)
    img.save(os.path.join(OUT, f"{i:04d}.jpg"), quality=82)
    if i % 30 == 0:
        print(f"frame {i}/{N}", flush=True)
print("DONE")
