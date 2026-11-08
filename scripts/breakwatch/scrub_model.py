"""A learned model's caption words, cleared of the household's details before it ships (2026-10-09).

    python scripts/breakwatch/scrub_model.py <learned.json> [--check]

The caption classifier keeps every word and word pair it met in the recordings' captions, with a weight. Television says common first
names all day (a character in a sitcom), and one of them can be a name on the publishing machine's private list
(~/.prism/public-scrub.txt, the list scripts/release/public-snapshot.py checks the tree against): the release then refuses to go out,
rightly. This drops those words from the model - a few of tens of thousands; score the exams again after (run_exams.py --model).
--check only lists how many would go. Run it on every export, before the model is copied into the host's Assets.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("snap", os.path.join(HERE, "..", "release", "public-snapshot.py"))
snap = importlib.util.module_from_spec(spec)
argv, sys.argv = sys.argv, ["public-snapshot.py", "none"]
try:
    spec.loader.exec_module(snap)
except SystemExit:
    pass
sys.argv = argv
pats = snap.patterns()
m = json.load(open(path, encoding="utf-8"))
w = m["caption"]["weights"]
gone = [k for k in w if any(rx.search(k) for rx in pats)]
print(len(gone), "of", len(w), "caption words match the private list")
if "--check" not in sys.argv and gone:
    for k in gone:
        del w[k]
    f = open(path, "w", encoding="utf-8"); json.dump(m, f, separators=(",", ":")); f.close()
    print("removed; the model file is rewritten")
