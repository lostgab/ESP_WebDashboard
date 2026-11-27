"""Render a turntable flipbook: the scene from many camera angles x many moments.

The camera is freed from the fish and put on a turntable around the anemone.
The player (vader_turntable.html) lets you DRAG to spin the view and scrub
time, like orbiting a GLB model.

Run once:  py -3 vader_turntable.py
"""
import os

import numpy as np
from PIL import Image

import clownfish

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vader_turntable")
os.makedirs(OUT, exist_ok=True)

ANGLES = 16          # camera positions around the scene
TIMES = 60           # moments in the loop (2 s @ 30 fps)
R = 1.55             # camera distance from the pivot
CAM_Z = 0.5

print(f"Rendering {ANGLES} angles x {TIMES} times = {ANGLES * TIMES} frames -> {OUT}")
count = 0
for a in range(ANGLES):
    az = 2 * np.pi * a / ANGLES
    cx = clownfish.PIVOT[0] + R * np.cos(az)
    cy = clownfish.PIVOT[1] + R * np.sin(az)
    for i in range(TIMES):
        t = i / 30.0
        img = clownfish.frame_turntable(t, cx, cy, CAM_Z, code=False)
        img = img.resize((clownfish.W // 2, clownfish.H // 2), Image.BOX)
        img.save(os.path.join(OUT, f"a{a:02d}_t{i:03d}.jpg"), quality=82)
        count += 1
        if count % 30 == 0:
            print(f"frame {count}/{ANGLES * TIMES}", flush=True)
print("DONE")
