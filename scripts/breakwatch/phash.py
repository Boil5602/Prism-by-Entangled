"""Phase 5a of the boundary-first redesign (2026-11-08): a perceptual hash a second for every golden frame, as a sidecar.

    python scripts/breakwatch/phash.py hash [<day> ...]        write <golden>/<day>/<window>/phash.npz (t: seconds of the day, h: uint64)

The hash: the 320x180 grey frame averaged to 32x18 blocks (10x10 pixels), a 2-D DCT, the 8x8 lowest frequencies less the DC term, each
bit = coefficient above the median of the 63. Two frames of the same picture under a little noise or a different encode differ in a few
bits; different pictures differ in about half. The frames themselves are never altered (the standing condition); a window's sidecar is
rewritten only when its frame count changed.
"""
import glob
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")


def dct_matrix(n):
    k = np.arange(n)[:, None]; x = np.arange(n)[None, :]
    m = np.cos(np.pi * (2 * x + 1) * k / (2 * n)) * np.sqrt(2 / n); m[0] /= np.sqrt(2)
    return m


D18, D32 = dct_matrix(18), dct_matrix(32)


def hash_frames(frames):
    """frames: (n, 180, 320) uint8 -> (n,) uint64."""
    a = frames.reshape(len(frames), 18, 10, 32, 10).mean(axis=(2, 4)).astype(np.float32)   # 18 x 32 blocks
    c = D18 @ a @ D32.T                                                                      # (n, 18, 32)
    low = c[:, :8, :8].reshape(len(frames), 64)[:, 1:]                                      # 63 coefficients, the DC term left out
    bits = low > np.median(low, axis=1, keepdims=True)
    h = np.zeros(len(frames), np.uint64)
    for i in range(63): h |= bits[:, i].astype(np.uint64) << np.uint64(i)
    return h


def t_of(name): return int(name[:2]) * 3600 + int(name[2:4]) * 60 + int(name[4:6]) + int(name[6:9]) / 1000.0


def hash_window(path):
    fs = sorted(glob.glob(os.path.join(path, "*.gray")))
    out = os.path.join(path, "phash.npz")
    if os.path.exists(out):
        try:
            z = np.load(out)
            if len(z["t"]) == len(fs): return path, len(fs), "kept"
        except Exception:
            pass
    ts, hs = [], []
    for k in range(0, len(fs), 256):
        chunk = fs[k:k + 256]; frames = []; tt = []
        for f in chunk:
            a = np.fromfile(f, dtype=np.uint8)
            if a.size != 320 * 180: continue
            frames.append(a.reshape(180, 320)); tt.append(t_of(os.path.basename(f)[:-5]))
        if frames: hs.append(hash_frames(np.stack(frames))); ts.extend(tt)
    h = np.concatenate(hs) if hs else np.zeros(0, np.uint64)
    np.savez(out, t=np.array(ts, np.float64), h=h)
    return path, len(ts), "written"


def dump(day, win, n, out):
    """(frame path, hash as 16 hex digits) for the first n frames of a window: the C# port's parity check (bwtest phashparity)."""
    fs = sorted(glob.glob(os.path.join(GOLD, day, win, "*.gray")))[:n]
    frames = np.stack([np.fromfile(f, np.uint8).reshape(180, 320) for f in fs]); h = hash_frames(frames)
    with open(out, "w") as f:
        for path, hh in zip(fs, h): f.write(f"{path},{int(hh):016x}\n")
    print("dumped", len(fs), "frames to", out)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "hash"
    if mode == "dump": dump(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]); sys.exit(0)
    days = sys.argv[2:] or [os.path.basename(d) for d in sorted(glob.glob(os.path.join(GOLD, "2026-*")))]
    jobs = [w for d in days for w in sorted(glob.glob(os.path.join(GOLD, d, "*"))) if os.path.isdir(w) and glob.glob(os.path.join(w, "*.gray"))]
    print(len(jobs), "windows", flush=True)
    with ProcessPoolExecutor(int(os.environ.get("WORKERS", "3"))) as ex:
        for path, n, what in ex.map(hash_window, jobs):
            print(os.path.relpath(path, GOLD), n, what, flush=True)
    print("done", flush=True)
