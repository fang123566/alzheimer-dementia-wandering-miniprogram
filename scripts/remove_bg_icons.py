from __future__ import annotations

from pathlib import Path
from collections import deque

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

FILES = [
    ASSETS / "记忆相册.jpg",
    ASSETS / "家庭组.jpg",
    ASSETS / "今日提醒.jpg",
    ASSETS / "方言助手.jpg",
]


def remove_bg_edge_flood(img_rgba: Image.Image, tol: int = 30) -> tuple[Image.Image, tuple[int, int, int]]:
    """
    Remove ONLY the outer background connected to image edges.
    This protects interior pixels of the icon even if they share similar colors.
    """
    arr = np.array(img_rgba)
    rgb = arr[..., :3].astype(np.int16)
    h, w, _ = rgb.shape

    border = np.concatenate([rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]], axis=0)
    q = (border // 8) * 8  # quantize to reduce JPEG noise
    vals, counts = np.unique(q.reshape(-1, 3), axis=0, return_counts=True)
    bg = vals[counts.argmax()].astype(np.int16)

    diff = rgb - bg
    dist = np.sqrt((diff * diff).sum(axis=2))
    bg_like = dist <= tol

    # Flood fill from edges on bg_like pixels only
    mask = np.zeros((h, w), dtype=bool)
    dq: deque[tuple[int, int]] = deque()

    def push(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and (not mask[y, x]) and bool(bg_like[y, x]):
            mask[y, x] = True
            dq.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)

    while dq:
        y, x = dq.popleft()
        push(y - 1, x)
        push(y + 1, x)
        push(y, x - 1)
        push(y, x + 1)

    # Set alpha to 0 for background; feather 1px ring to remove halos
    alpha = arr[..., 3].astype(np.uint8)
    alpha[mask] = 0

    dil = mask.copy()
    dil[:-1, :] |= mask[1:, :]
    dil[1:, :] |= mask[:-1, :]
    dil[:, :-1] |= mask[:, 1:]
    dil[:, 1:] |= mask[:, :-1]
    ring = dil & (~mask) & bg_like
    alpha[ring] = np.minimum(alpha[ring], 40)

    out = arr.copy()
    out[..., 3] = alpha
    return Image.fromarray(out, "RGBA"), (int(bg[0]), int(bg[1]), int(bg[2]))


def main() -> int:
    missing = [p for p in FILES if not p.exists()]
    if missing:
        print("Missing files:")
        for p in missing:
            print(f" - {p}")
        return 2

    for p in FILES:
        img = Image.open(p).convert("RGBA")
        out, bg = remove_bg_edge_flood(img, tol=30)
        out_path = p.with_suffix(".png")
        out.save(out_path, optimize=True)
        print(f"OK {p.name} -> {out_path.name} bg={bg} size={out.size}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

