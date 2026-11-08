"""The person's own words taken out of the tree (2026-11-04, the owner asked that their messages not be in the public archive).

The docs, the ledger and the code's comments had been written with the owner's requests quoted verbatim beside a date. The public
repository carries the file tree, so those quotations were public. This takes a quotation out wherever it sits beside a date or a
word that marks it as someone's (asked, said, report, the person, the user), before or after it, in Markdown, in comment lines of
code (never a string literal: only lines that are a comment), and in the adapters' JSON notes. The date and the surrounding sentence
stay; the ask is described in Prism's own words from now on (CLAUDE.md), never quoted.

Text is worked in runs: a Markdown paragraph (between blank lines, outside a code fence) or a block of consecutive comment lines, so a
quotation that wraps onto the next line is found; a run that lost nothing is written back unchanged, and only a line that changed is
tidied. A trailing comment on a code line is worked alone.

    python scripts/release/strip-quotes.py                  dry run: counts by file and a sample of what would change
    python scripts/release/strip-quotes.py --apply          rewrite the files in place
    python scripts/release/strip-quotes.py --loose [--apply]  also a quotation that speaks as a person (I, we, my, you, please),
                                                            wherever it sits
    python scripts/release/strip-quotes.py --left           lines that still hold a long quotation (for a hand pass)
    python scripts/release/strip-quotes.py --gate           the public snapshot's check: fails while a --left line is not one a person
                                                            has judged not to be the owner's words (quotes-ok.txt)
    python scripts/release/strip-quotes.py --accept         after a hand pass: every --left line now is judged not the owner's (UI
                                                            text, log text, a page's words) and goes into quotes-ok.txt

--apply is retired (2026-11-05): its pattern ran across a table's rows and deleted 71 ledger rows on 2026-11-04 (14bf5ec7). Quotations are
described by hand, a line at a time.
"""
import io
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APPLY = "--apply" in sys.argv
LOOSE = "--loose" in sys.argv
LEFT = "--left" in sys.argv
GATE = "--gate" in sys.argv
ACCEPT = "--accept" in sys.argv
OKFILE = os.path.join(ROOT, "scripts", "release", "quotes-ok.txt")
if APPLY:
    sys.exit("--apply is retired: it deleted 71 ledger rows on 2026-11-04 (14bf5ec7). Describe the owner's words by hand, a line at a time.")
MIN = 12
DATE = r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T][0-9:]{4,8})?"
MARK = r"(?:" + DATE + r"|asked|said|says|report(?:ed|s)?|the person|the owner|the user|User:|their words|verbatim)"
PERSON = r"\b(?:I|I'm|I've|I'd|I'll|we|we're|we've|my|me|mine|you|your|please|let's|lets|can we|should we|could we|do we|don't|dont|doesn't|isn't|wasn't|didn't)\b"
# a quotation: never across a blank line, never more than 400 characters
Q = r'"(?:(?!\n\n)[^"]){%d,400}"' % MIN
QL = r'"(?:(?!\n\n)[^"]){25,400}"'
QA = r'"(?:(?!\n\n)[^"]){%d,1500}"' % MIN   # a ledger row is one line; its quotation may run long
# quotations in a person's voice that are not the person's: the words a system shows
EXCEPT = ("Windows protected your PC", "Try searching to get started")
# files whose quotations are the person's almost without exception (the ledger's cells): every prose quotation of MIN+ characters
# with two or more spaces goes, wherever it sits; code in backticks is left
ALL_FILES = ("docs/bugs/LEDGER.md",)
ALL = False

SKIP_DIRS = ("node_modules", "dist", "golden", ".git", "bin", "obj", "out", "__pycache__")
TEXT = {".md": "md", ".ts": "code", ".js": "code", ".mjs": "code", ".cs": "code", ".py": "py", ".json": "json", ".jsx": "code", ".txt": "md"}
PREFIX = re.compile(r"^(\s*(?:///|//|/\*\*|/\*|\*|#)\s?)")
# a line that is only a comment marker (the opener or closer of a block, a bare //): a boundary between runs, kept as it is
BOUNDARY = re.compile(r"^\s*(?:/\*\*|/\*|\*/|///|//|\*|#)\s*$")


def tracked():
    r = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return [p for p in r.stdout.split("\n") if p and not any(("/" + d + "/") in ("/" + p) for d in SKIP_DIRS)]


def tidy(s):
    """The punctuation around a removed quotation, on a line that lost one."""
    s = re.sub(r"\*\*\s*\*\*", "", s)
    s = re.sub(r"(?:\s+/){2,}(?=[\s)\]:,.]|$)", "", s)
    s = re.sub(r"\(\s+/\s+", "(", s)
    s = re.sub(r"\(\s*\)", "", s)
    s = re.sub(r",\s*\)", ")", s)
    s = re.sub(r"[:;]\s*\)", ")", s)
    s = re.sub(r"\(\s*,\s*", "(", s)
    s = re.sub(r",\s*,", ",", s)
    s = re.sub(r"\s+-\s*;", ";", s)
    s = re.sub(r"[ \t]+([,.;:)])", r"\1", s)
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"(\S)[ \t]{2,}(\S)", r"\1 \2", s)
    return s.rstrip()


def tidy_line(line):
    indent = len(line) - len(line.lstrip())
    return line[:indent] + tidy(line[indent:])


def strip_run(text):
    """The quotations in one run of prose (newlines inside); returns (new_text, count)."""
    count = [0]

    def gone(m, keep):
        count[0] += 1
        return keep
    # a mark, then within 80 characters the quotation
    after = re.compile("(" + MARK + r')([^"\n]{0,80}?)(?:\s*' + Q + ")", re.IGNORECASE | re.DOTALL)
    text = after.sub(lambda m: gone(m, m.group(1) + m.group(2).rstrip()), text)
    text = after.sub(lambda m: gone(m, m.group(1) + m.group(2).rstrip()), text)
    # the quotation, then within 12 characters a date: ("...", 2026-09-23) or **"..."** (2026-10-28
    before = re.compile(r"(?:\*\*)?" + Q + r"(?:\*\*)?(\s*[,;:]?\s*\(?\s*)(?=" + DATE + ")", re.DOTALL)
    text = before.sub(lambda m: gone(m, m.group(1).lstrip(",;: ") if m.group(1).strip() else ""), text)
    if ALL:
        anyq = re.compile(r"([,:;]?\s*)(\()?(?:\*\*)?(" + QA + r")(?:\*\*)?(\))?", re.DOTALL)

        def arepl(m):
            q = m.group(3)
            if q.count(" ") < 2 or "`" in q or any(x in q for x in EXCEPT):
                return m.group(0)
            count[0] += 1
            if m.group(2) and m.group(4):
                return ""
            return (m.group(4) or "") if not m.group(2) else "("
        text = anyq.sub(arepl, text)
    if LOOSE:
        loose = re.compile(r"([,:;]?\s*)(\()?(?:\*\*)?(" + QL + r")(?:\*\*)?(\))?", re.DOTALL)

        def lrepl(m):
            q = m.group(3)
            if not re.search(PERSON, q) or any(x in q for x in EXCEPT):
                return m.group(0)
            count[0] += 1
            if m.group(2) and m.group(4):
                return ""
            return (m.group(4) or "") if not m.group(2) else "("
        text = loose.sub(lrepl, text)
    return text, count[0]


def strip_json_line(line):
    """The adapters' notes: quotations are escaped inside a JSON string."""
    esc_q = r'\\"[^"\\]{%d,}\\"' % MIN
    count = [0]
    pat = re.compile("(" + MARK + r")([^\\\n]{0,80}?)(?:\s*" + esc_q + ")", re.IGNORECASE)

    def repl(m):
        count[0] += 1
        return m.group(1) + m.group(2).rstrip()
    out = pat.sub(repl, line)
    before = re.compile(esc_q + r"(\s*[,;:]?\s*\(?\s*)(?=" + DATE + ")")
    out = before.sub(lambda m: (count.__setitem__(0, count[0] + 1) or (m.group(1).lstrip(",;: ") if m.group(1).strip() else "")), out)
    if LOOSE:
        lp = re.compile(r'[,:;]?\s*\(?\\"[^"\\]{25,}\\"')

        def lrepl(m):
            if not re.search(PERSON, m.group(0)):
                return m.group(0)
            count[0] += 1
            return ""
        out = lp.sub(lrepl, out)
    if count[0]:
        out = re.sub(r"\(\s*\)", "", out)
        out = re.sub(r",\s*\)", ")", out)
        out = re.sub(r"[:;]\s*\)", ")", out)
        out = re.sub(r"[ ]+([,.;:)])", r"\1", out)
    return out, count[0]


def runs_md(lines):
    """Paragraph runs of a Markdown file: (start, end) over lines outside code fences, split at blank lines."""
    runs = []; start = None; fence = False
    for i, l in enumerate(lines):
        if l.strip().startswith("```"):
            if start is not None: runs.append((start, i)); start = None
            fence = not fence; continue
        if fence or not l.strip():
            if start is not None: runs.append((start, i)); start = None
            continue
        if start is None: start = i
    if start is not None: runs.append((start, len(lines)))
    return runs


def runs_code(lines):
    """Runs of consecutive comment lines; a code line with a trailing comment is a run of one (its tail only)."""
    runs = []; start = None
    for i, l in enumerate(lines):
        if PREFIX.match(l) and l.strip() and not BOUNDARY.match(l):
            if start is None: start = i
        else:
            if start is not None: runs.append((start, i, "comment")); start = None
            j = l.find("//")
            if j >= 0 and l[:j].count('"') % 2 == 0: runs.append((i, i + 1, "tail"))
    if start is not None: runs.append((start, len(lines), "comment"))
    return runs


def work_run(lines, start, end, prefixed):
    """One run worked as a whole; returns (new_lines, count)."""
    if prefixed:
        prefixes = []; bodies = []
        for l in lines[start:end]:
            m = PREFIX.match(l); prefixes.append(m.group(1)); bodies.append(l[m.end():])
        joined = "\n".join(bodies)
    else:
        joined = "\n".join(lines[start:end])
    new, n = strip_run(joined)
    if not n:
        return lines[start:end], 0
    parts = new.split("\n")
    out = []
    for k, part in enumerate(parts):
        if prefixed:
            pre = prefixes[k] if k < len(prefixes) else prefixes[-1]
            out.append(tidy_line(pre + part) if (k >= len(bodies) or part != bodies[k]) else pre + part)
        else:
            orig = lines[start + k] if start + k < end else None
            out.append(tidy_line(part) if part != orig else part)
    return out, n


def process(path):
    ext = os.path.splitext(path)[1].lower()
    kind = TEXT.get(ext)
    if not kind:
        return None
    full = os.path.join(ROOT, path)
    raw = io.open(full, "rb").read()
    try:
        text = raw.decode("utf-8"); enc = "utf-8"
    except UnicodeDecodeError:
        text = raw.decode("cp1252"); enc = "cp1252"
    global ALL
    ALL = path.replace(os.sep, "/") in ALL_FILES
    crlf = "\r\n" in text
    lines = text.replace("\r\n", "\n").split("\n")
    n = 0; out = []
    if kind == "json":
        for l in lines:
            nl, k = strip_json_line(l); n += k; out.append(nl)
    elif kind == "md":
        pos = 0
        for s, e in runs_md(lines):
            out.extend(lines[pos:s]); nl, k = work_run(lines, s, e, False); out.extend(nl); n += k; pos = e
        out.extend(lines[pos:])
    else:
        pos = 0
        for s, e, what in runs_code(lines):
            out.extend(lines[pos:s])
            if what == "comment":
                nl, k = work_run(lines, s, e, True); out.extend(nl); n += k
            else:
                l = lines[s]; j = l.find("//")
                new, k = strip_run(l[j:]); n += k
                out.append(l[:j] + (tidy(new) if k else l[j:]))
            pos = e
        out.extend(lines[pos:])
    new_text = "\n".join(out)
    if crlf: new_text = new_text.replace("\n", "\r\n")
    return (new_text, n, enc, text)


def left_over(path):
    ext = os.path.splitext(path)[1].lower()
    kind = TEXT.get(ext)
    if kind not in ("code", "py", "md"):
        return []
    raw = io.open(os.path.join(ROOT, path), "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")   # the host's cp1252 sources are read too (2026-11-05: they had been skipped)
    hits = []
    long_line = r'"[^"\n]{25,}"'
    for i, l in enumerate(text.replace("\r\n", "\n").split("\n"), 1):
        if kind != "md" and not PREFIX.match(l):
            j = l.find(" //")
            if j < 0 or l[:j].count('"') % 2 == 1:
                continue
            l = l[j:]
        for q in re.findall(long_line, l):
            if re.search(MARK, l, re.IGNORECASE) or re.search(PERSON, q):
                hits.append((i, l.strip()[:160])); break
        else:
            if re.search(MARK, l, re.IGNORECASE) and l.count('"') % 2 == 1 and re.search(r'"[^"]{12,}$', l):
                hits.append((i, "(wraps) " + l.strip()[:150]))
    return hits


# the wider sweep the gate adds (2026-11-05: the line scan missed quotations that wrap over lines, sit in single quotes or open a line, and
# a public push nearly carried them): every quotation found from its opening quote - after "(", ": ", "> ", ", ", "- ", "; ", "[" or at a
# line's start - read to its closing quote (no blank line, 1500 characters at most), kept when it speaks as a person
VOICE = re.compile(r"(?<![A-Za-z'])(I|I'm|I've|I'd|I'll|Im|Ive|Id|we're|we've|we'll|let's|lets|Let's|Lets|my|me|Can we|Could we|Should we|"
                   r"Do we|We need|we need|we should|We should|can you|Can you|my wife|Why not|Is there|How about|What about)(?![A-Za-z'])")
OPENQ = re.compile(r'(?:(?<=\()|(?<=: )|(?<=> )|(?<=, )|(?<=- )|(?<=; )|(?<=\[)|^\s*|(?<=\* ))(["\u201c\'])', re.M)
VOICE_SKIP = ("node_modules/", "packages/core/data/", "prototypes/prism-veil-art/candidates/", "/fixtures/", ".data.ts", "package-lock.json",
              "Channel.g.cs", "scripts/release/strip-quotes.py", "scripts/release/quotes-ok.txt")
VOICE_EXT = (".md", ".json", ".cs", ".ts", ".mjs", ".js", ".py", ".jsx", ".kt", ".html", ".ps1", ".sh")


def voice_spans(path):
    if not path.endswith(VOICE_EXT) or any(x in path for x in VOICE_SKIP):
        return []
    raw = io.open(os.path.join(ROOT, path), "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
    hits = []
    for m in OPENQ.finditer(text):
        close = "\u201d" if m.group(1) == "\u201c" else m.group(1)
        j = text.find(close, m.end())
        if j < 0 or j - m.end() > 1500:
            continue
        q = text[m.end():j]
        if len(q) < 15 or re.search(r"\n\s*\n", q) or not VOICE.search(q):
            continue
        if m.group(1) == "'" and len(q) < 20:
            continue
        hits.append((text.count("\n", 0, m.start()) + 1, "(voice) " + " ".join(q.split())[:160]))
    return hits


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    files = tracked()
    if GATE or ACCEPT:
        import hashlib
        key = lambda p, l: p + "\t" + hashlib.sha1(" ".join(l.split()).encode("utf-8")).hexdigest()[:16]
        ok = set()
        if os.path.exists(OKFILE):
            ok = {x.strip() for x in io.open(OKFILE, encoding="utf-8") if x.strip() and not x.startswith("#")}
        now = [(p, i, l, key(p, l)) for p in files for i, l in left_over(p) + voice_spans(p)]
        if ACCEPT:
            keys = sorted(ok | {k for *_, k in now})
            f = io.open(OKFILE, "w", encoding="utf-8", newline="\n")
            f.write("# lines strip-quotes.py --left flags that a person judged not to be the owner's words: path, then a hash of the line\n")
            f.write("\n".join(keys) + "\n"); f.close()
            print(len(keys), "lines accepted")
            return
        unknown = [(p, i, l) for p, i, l, k in now if k not in ok]
        for p, i, l in unknown:
            print(f"{p}:{i}: {l}")
        if unknown:
            print(len(unknown), "lines may still hold the owner's words: describe them, or --accept after a hand pass")
            sys.exit(1)
        print("no owner's words left that a person has not judged")
        return
    if LEFT:
        total = 0
        for p in files:
            for i, l in left_over(p):
                total += 1; print(f"{p}:{i}: {l}")
        print(total, "lines still hold a long quotation beside a mark or in a person's voice")
        return
    total = 0; changed = []; samples = []
    for p in files:
        r = process(p)
        if not r:
            continue
        new, n, enc, old = r
        if not n or new == old:
            continue
        total += n; changed.append((p, n))
        if len(samples) < 14:
            for a, b in zip(old.split("\n"), new.split("\n")):
                if a != b and len(samples) < 14:
                    samples.append((p, a.strip()[:150], b.strip()[:150]))
        if APPLY:
            io.open(os.path.join(ROOT, p), "wb").write(new.encode(enc))
    for p, n in sorted(changed, key=lambda x: -x[1])[:25]:
        print(f"{n:5d}  {p}")
    print(f"{total} quotations in {len(changed)} files" + (" rewritten" if APPLY else " (dry run; --apply to rewrite)"))
    if not APPLY:
        print("\nsamples:")
        for p, a, b in samples:
            print(f"- {p}\n    {a}\n    {b}")


main()
