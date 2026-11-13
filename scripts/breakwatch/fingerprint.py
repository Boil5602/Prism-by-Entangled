"""Addendum E3 (2026-11-08): a landmark (constellation) audio fingerprinter, the prototype the C# and JS ports follow line for line.

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/fingerprint.py prints <pcm.f32> [<out.npz>]      the landmarks of a 16 kHz mono recording
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/fingerprint.py selfmatch <pcm.f32>               stretches that recur inside one recording
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/fingerprint.py match <query.f32> <lib.f32> [...]  a query against recordings

The scheme (the shape every port shares, so a pack can carry the library):
  - 16 kHz mono float; frames of 1024 samples every 512 (32 ms), a Hann window, |FFT| in dB (log10 of power, floored at -100);
  - peaks: a bin that is the maximum of its neighbourhood of +-7 frames and +-9 bins, at least 10 dB above the frame's median and
    above an absolute floor, at most 6 a frame (the loudest), in bins 4 to 300 (62 Hz to 4.7 kHz: speech and music, under the MP3's cut);
  - landmarks: each peak paired with the next 8 peaks that follow it by 1 to 48 frames (32 ms to 1.5 s) within +-48 bins; the hash is
    (f1 << 20) | (f2 << 10) | dt, 30 bits, kept with the anchor's frame;
  - matching: a query's hashes looked up in the index; for each hit the offset (library frame - query frame) votes; a track whose
    best offset gathers 12 or more votes within +-1 frame over a 2 s query window is a lock. Nothing about the sound leaves the device.
"""
import json
import os
import sys
from collections import defaultdict

import numpy as np

SR = 16000; N = 1024; HOP = 512
DB_FLOOR = -70.0; MIN_ABOVE_MEDIAN = 10.0; MAX_PER_FRAME = 6; BIN_LO, BIN_HI = 4, 300
T_RAD, F_RAD = 7, 9; FAN = 8; DT_MIN, DT_MAX = 1, 48; DF_MAX = 48


def spectrogram(x):
    if len(x) < N: return np.zeros((0, N // 2 + 1), np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP]
    win = np.hanning(N).astype(np.float32)
    spec = np.abs(np.fft.rfft(frames * win, axis=1)) ** 2
    return (10 * np.log10(np.maximum(spec, 1e-10))).astype(np.float32)


def peaks(S):
    """(frame, bin) of the spectral peaks, in frame order."""
    out = []
    T, F = S.shape
    sub = S[:, BIN_LO:BIN_HI]
    # a local maximum over the neighbourhood: a maximum filter by separable sliding maxima
    from numpy.lib.stride_tricks import sliding_window_view
    pad_t = np.pad(sub, ((T_RAD, T_RAD), (0, 0)), constant_values=-1e9); mt = sliding_window_view(pad_t, 2 * T_RAD + 1, axis=0).max(axis=2)
    pad_f = np.pad(mt, ((0, 0), (F_RAD, F_RAD)), constant_values=-1e9); mx = sliding_window_view(pad_f, 2 * F_RAD + 1, axis=1).max(axis=2)
    med = np.median(sub, axis=1, keepdims=True)
    cand = (sub >= mx) & (sub > med + MIN_ABOVE_MEDIAN) & (sub > DB_FLOOR)
    for t in np.flatnonzero(cand.any(axis=1)):
        bins = np.flatnonzero(cand[t])
        if len(bins) > MAX_PER_FRAME: bins = bins[np.argsort(-sub[t, bins])[:MAX_PER_FRAME]]
        for b in sorted(bins): out.append((int(t), int(b) + BIN_LO))
    return out


def landmarks(pk):
    """[(hash, anchor frame)] from the peaks (frame order)."""
    out = []
    for i, (t1, f1) in enumerate(pk):
        n = 0
        for j in range(i + 1, len(pk)):
            t2, f2 = pk[j]; dt = t2 - t1
            if dt < DT_MIN: continue
            if dt > DT_MAX: break
            if abs(f2 - f1) > DF_MAX: continue
            out.append(((f1 << 20) | (f2 << 10) | dt, t1)); n += 1
            if n >= FAN: break
    return out


def prints(x):
    return landmarks(peaks(spectrogram(x)))


def load(path):
    return np.fromfile(path, dtype=np.float32)


class Index:
    def __init__(self): self.table = defaultdict(list); self.tracks = []
    def add(self, name, lm):
        tid = len(self.tracks); self.tracks.append(name)
        for h, t in lm: self.table[h].append((tid, t))
    def query(self, lm, min_votes=12):
        """[(track, offset frames, votes)] best first; the offset is library frame minus query frame."""
        votes = defaultdict(int)
        for h, tq in lm:
            for tid, tl in self.table.get(h, ()): votes[(tid, tl - tq)] += 1
        # votes within +-1 frame pooled
        pooled = defaultdict(int)
        for (tid, off), v in votes.items():
            for d in (-1, 0, 1): pooled[(tid, off + d)] += v
        best = sorted(((self.tracks[tid], off, v) for (tid, off), v in pooled.items() if v >= min_votes), key=lambda r: -r[2])
        return best


def frames_to_s(f): return f * HOP / SR


def decode(mp3, bwtest=None):
    """An MP3 to 16 kHz mono float32 through the bench's decoder (NAudio); cached beside the file as .f32."""
    import subprocess
    out = mp3[:-4] + ".f32"
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(mp3):
        exe = bwtest or os.path.join(os.path.dirname(os.path.abspath(__file__)), "bwtest", "bin", "Release-r5", "bwtest.exe")
        subprocess.run([exe, "mp3pcm", mp3, out], capture_output=True)
    return load(out) if os.path.exists(out) else np.zeros(0, np.float32)


def harvest(audio_dirs, out_json, min_votes=20, win_s=10):
    """The repeats across the hour files of one or more days (E3's harvester, 2026-11-08): every hour's landmarks indexed; each hour queried
    in 10 s windows against the OTHER hours; a hit (an offset with min_votes or more) marks the window as heard again elsewhere; adjacent hits
    at a steady offset join into one segment. Written as JSON: the segments with their source and target hours and times, their lengths, and
    the totals by length bucket (15 / 30 / 60 / 90 s units against longer runs, the reruns). The channel of a segment is left to the caller
    (channels.json of the screen window at that time) because audio.log's owner is often blank on this build."""
    # one file per hour name: keep.py copies a closed hour into the day folder and the live folder still holds it, so the first folder
    # named wins (the day's), or a whole hour would match its own copy as a simulcast (23:20 on 2026-11-08: 62 "reruns" that were copies)
    files = []; seen = set()
    for d in audio_dirs:
        for f in sorted(os.listdir(d)):
            if f.endswith(".mp3") and f not in seen: files.append(os.path.join(d, f)); seen.add(f)
    tracks = {}
    for f in files:
        x = decode(f)
        if len(x) < SR * 60: continue
        tracks[f] = (prints(x), len(x) / SR)
        print(f"{os.path.relpath(f)}: {len(x) / SR:.0f} s, {len(tracks[f][0])} landmarks", flush=True)
    idx = Index()
    for f, (lm, _) in tracks.items(): idx.add(f, lm)
    wf = int(win_s * SR / HOP)
    segments = []
    for f, (lm, secs) in tracks.items():
        by_w = defaultdict(list)
        for h, t in lm: by_w[t // wf].append((h, t))
        last = None
        for w in sorted(by_w):
            hits = [(tr, off, v) for tr, off, v in idx.query(by_w[w], min_votes=min_votes) if tr != f or abs(off) > 3 * wf]
            if not hits: last = None; continue
            tr, off, v = hits[0]
            if last and last["target"] == tr and abs(last["offset_frames"] - off) <= 2 and w == last["end_window"] + 1:
                last["end_window"] = w; last["votes"] += v
            else:
                last = dict(source=f, start_s=frames_to_s(w * wf), end_window=w, start_window=w, target=tr, offset_frames=off, target_start_s=frames_to_s(w * wf + off), votes=v)
                segments.append(last)
    # the channel of a segment and of its target: the screen window's channel timeline (channels.json) at the file's clock time; the
    # hour files are named HHMMSS of their start and the sound is the screen's (the audible tile)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from channels import channel_at
    def clock_of(path, s_into):
        name = os.path.basename(path)[:6]
        try: return int(name[:2]) * 3600 + int(name[2:4]) * 60 + int(name[4:6]) + s_into
        except ValueError: return None
    # HARVEST_SAMPLER_LOG (2026-11-08): under the idle sampler the screen's own timeline names the multiview page, not the channel; the
    # sampler's log does ("HH:MM:SS slot: A, B, C", slot 0 = the screen), each slot holding until the next
    slots = []
    if os.environ.get("HARVEST_SAMPLER_LOG") and os.path.exists(os.environ["HARVEST_SAMPLER_LOG"]):
        for line in open(os.environ["HARVEST_SAMPLER_LOG"], encoding="utf-8", errors="replace"):
            if " slot: " in line:
                hms, rest = line.split(" slot: ", 1); h, m, sec_ = hms.strip().split(":")
                slots.append((int(h) * 3600 + int(m) * 60 + int(sec_), rest.split(",")[0].strip()))
    def chan_of(path, s_into):
        t = clock_of(path, s_into)
        if t is None: return None
        if slots:
            name = None
            for at, ch in slots:
                if at <= t: name = ch
                else: break
            return name
        day = os.path.basename(os.path.dirname(os.path.dirname(path))) if os.path.basename(os.path.dirname(path)) == "audio" else os.environ.get("HARVEST_DAY", "")
        if not day.startswith("2026-"): return None
        cid, name = channel_at(day, os.environ.get("HARVEST_WINDOW", "screen"), t); return name or cid
    for sgm in segments:
        sgm["length_s"] = (sgm["end_window"] - sgm["start_window"] + 1) * win_s; sgm["end_s"] = sgm["start_s"] + sgm["length_s"]
        sgm["offset_s"] = frames_to_s(sgm["offset_frames"]); sgm["cross_file"] = sgm["source"] != sgm["target"]
        sgm["channel"] = chan_of(sgm["source"], sgm["start_s"]); sgm["target_channel"] = chan_of(sgm["target"], sgm["target_start_s"])
        sgm["cross_channel"] = bool(sgm["channel"] and sgm["target_channel"] and sgm["channel"] != sgm["target_channel"])
        for k in ("end_window", "start_window", "offset_frames"): sgm.pop(k)
    buckets = defaultdict(int)
    for sgm in segments:
        L = sgm["length_s"]; buckets["10-20 s" if L <= 20 else "30-40 s" if L <= 40 else "50-90 s" if L <= 90 else "over 90 s (a rerun or a simulcast)"] += 1
    rep = dict(hours=len(tracks), segments=len(segments), by_length=dict(buckets), cross_file=sum(1 for x in segments if x["cross_file"]),
               cross_channel=sum(1 for x in segments if x["cross_channel"]), same_channel=sum(1 for x in segments if x["channel"] and x["target_channel"] and not x["cross_channel"]),
               unknown_channel=sum(1 for x in segments if not (x["channel"] and x["target_channel"])), segments_list=segments)
    json.dump(rep, open(out_json, "w"), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "segments_list"}))


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "harvest": harvest(sys.argv[3:], sys.argv[2]); sys.exit(0)
    if mode == "prints":
        x = load(sys.argv[2]); lm = prints(x)
        print(f"{len(x) / SR:.0f} s, {len(lm)} landmarks ({len(lm) / max(1, len(x) / SR):.0f} a second)")
        if len(sys.argv) > 3:
            if sys.argv[3].endswith(".csv"):   # for the C# and JS ports' parity: hash,frame per line
                with open(sys.argv[3], "w") as f:
                    for h, t in lm: f.write(f"{h},{t}\n")
            else: np.savez(sys.argv[3], h=np.array([h for h, _ in lm], np.uint32), t=np.array([t for _, t in lm], np.int32))
    elif mode == "selfmatch":
        # stretches that recur inside one recording: every 15 s window queried against the whole, matches at another time reported
        x = load(sys.argv[2]); lm = prints(x); idx = Index(); idx.add("self", lm)
        total = len(x) / SR; win = 15; hits = []
        by_t = defaultdict(list)
        for h, t in lm: by_t[int(frames_to_s(t) // win)].append((h, t))
        for k in sorted(by_t):
            res = [(tr, off, v) for tr, off, v in idx.query(by_t[k], min_votes=20) if abs(off) > int(win * SR / HOP)]
            if res: tr, off, v = res[0]; hits.append((k * win, frames_to_s(off), v)); print(f"  {k * win:5.0f} s repeats at {k * win + frames_to_s(off):7.0f} s (offset {frames_to_s(off):+.1f} s, {v} votes)")
        print(f"{total:.0f} s: {len(hits)} windows of {win} s recur elsewhere in the recording")
    elif mode == "match":
        q = prints(load(sys.argv[2])); idx = Index()
        for p in sys.argv[3:]: idx.add(os.path.basename(p), prints(load(p)))
        for tr, off, v in idx.query(q)[:5]: print(f"  {tr} at {frames_to_s(off):+.1f} s: {v} votes")
    else: print(__doc__)
