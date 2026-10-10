"""The answer key's marking page (2026-10-07, "I don't mind training data. We'll need an interface where I can select the frames").

A kept recording (diagnostics/golden/<day>: each window's 320x180 frames and events.log, and calls.log, Prism's own covers) shown as
frames on a page; a person clicks the first and the last frame of each break, and the marks are saved as the scorecard's labels
(labels.json beside the recording, the format rates.py reads). Prism's own covers are drawn over the frames, so most breaks are a
check of two edges rather than a search.

    python scripts/breakwatch/label-ui.py [golden folder]              this machine only: http://127.0.0.1:8472/
    ... --blind                                                         an exam hour: no covers, no suggestions on the page
    python scripts/breakwatch/label-ui.py --lan <this PC's address> [--port N]    from a laptop or phone on the home network (a port
                                                                                   the firewall lets in on a private network)

The first picker on the page is what to mark, the most useful first: the stretches asked for by hand in marking-todo.json (beside
this script; keep it current), then each channel's stretch, the channel the detector has been trained on least first (trained.json).
Choosing one opens its window at the first frames not yet looked through. The list is built when the page's server starts.

A dev tool, never part of Prism. On the home network every request needs the key printed in the link (it shows the household's
TV pictures and saves marks); the key is kept beside the recording, so the link stays the same across restarts.
"""
import gzip
import io
import json
import time
import os
import re
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image

ARGS = sys.argv[1:]
LAN = ARGS[ARGS.index("--lan") + 1] if "--lan" in ARGS else None
if LAN:
    i = ARGS.index("--lan"); del ARGS[i:i + 2]
# a port the firewall already lets in on the home network (2026-10-07: Python's own rule covered public networks only, and a phone on
# the home Wi-Fi never got through; 8000 has a rule of its own on this PC)
PORT = int(ARGS[ARGS.index("--port") + 1]) if "--port" in ARGS else 8472
if "--port" in ARGS:
    i = ARGS.index("--port"); del ARGS[i:i + 2]
# --blind (2026-10-08): an exam hour. Prism's own covers and the model's suggestions are not shown, so the marks owe nothing to the
# detector they will be used to examine (scripts/breakwatch/exams.md). Marks made this way are the person's own reading of the frames.
BLIND = "--blind" in ARGS
if BLIND:
    ARGS.remove("--blind")
ROOT = ARGS[0] if ARGS else max(
    (os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden", d) for d in os.listdir(os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden"))),
    key=os.path.getmtime)
LABELS = os.path.join(ROOT, "labels.json")
KEYFILE = os.path.join(ROOT, "marking.key")
if not os.path.exists(KEYFILE):
    open(KEYFILE, "w").write(secrets.token_urlsafe(18))
KEY = open(KEYFILE).read().strip()


def sec(name):
    return int(name[:2]) * 3600 + int(name[2:4]) * 60 + int(name[4:6]) + (int(name[6:9]) / 1000 if len(name) >= 9 else 0)


def hms(t):
    t = int(round(t))
    return f"{t // 3600:02d}:{t // 60 % 60:02d}:{t % 60:02d}"


def windows():
    out = []
    for w in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, w)
        if not os.path.isdir(d):
            continue
        frames = sorted(f[:-5] for f in os.listdir(d) if f.endswith(".gray"))
        if not frames:
            continue
        st = [s for s in stretches(d) if s[1] >= sec(frames[0])]
        seen = [s[2] for s in st]   # every channel the window has had, in order ("TLC -> CNN" after a rotation)
        name = " → ".join(dict.fromkeys(seen)) if seen else w
        out.append({"id": w, "name": name, "frames": frames, "stretches": st})
    return out


def stretches(d):
    """A window's day as channel stretches, [from s, to s, channel], off the names its events.log carries about once a minute."""
    out = []
    ev = os.path.join(d, "events.log")
    if not os.path.exists(ev):
        return out
    for line in open(ev, encoding="utf-8", errors="replace"):
        if " edge " not in line[:40]:
            continue
        m = re.match(r"(\d{9}) \S+ edge \d (.+)", line.strip())
        if not m or not m.group(2).strip():
            continue
        t, n = sec(m.group(1)), m.group(2).strip()
        if out and out[-1][2] == n:
            out[-1][1] = t
        else:
            out.append([t, t, n])
    return out


def trained_hours():
    """Hours of each channel the learned detector has been trained on (trained.json, written at export), by channel name."""
    hours = {}
    try:
        man = json.load(open(os.path.join(HERE, "trained.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return hours
    for day, wins in man.items():
        for w, spans in wins.items():
            st = stretches(os.path.join(os.path.dirname(ROOT), day, w))
            for a, b in spans:
                a, b = sec(a.replace(":", "")), sec(b.replace(":", ""))
                for u, v, n in st:
                    hours[n] = hours.get(n, 0) + max(0, min(b, v) - max(a, u)) / 3600
    return hours


def todo():
    """What to mark, the most useful first (2026-10-09, "prioritize the classification work for me inside the screen ... top is
    highest"). First the stretches asked for by hand (marking-todo.json beside this script: an exam hour, a channel that needs
    training), in their order; then every channel stretch of half an hour or more, the channel the detector has seen least of first -
    an hour of a channel it has never been trained on teaches it more than a tenth hour of one it knows."""
    day = os.path.basename(ROOT.rstrip("\\/"))
    by = {w["id"]: w for w in WINDOWS}
    items = []
    try:
        asked = json.load(open(os.path.join(HERE, "marking-todo.json"), encoding="utf-8"))
    except (OSError, ValueError):
        asked = []
    for e in asked:
        if e.get("day") == day and e.get("window") in by:
            items.append({"win": e["window"], "name": e.get("name") or by[e["window"]]["name"], "from": e["from"], "to": e["to"], "why": e.get("why", "")})
    hours = trained_hours()
    rest = []
    for w in WINDOWS:
        for a, b, n in w["stretches"]:
            if b - a >= 1800:
                h = hours.get(n, 0)
                rest.append((h, a - b, {"win": w["id"], "name": n, "from": hms(a), "to": hms(b), "why": "never trained on" if h < 0.05 else f"{h:.1f} h trained on"}))
    rest.sort(key=lambda r: r[:2])
    return items + [r[2] for r in rest]


HERE = os.path.dirname(os.path.abspath(__file__))
WINDOWS = windows()
TODO = todo()
_rank = {}
for _i, _x in enumerate(TODO):
    _rank.setdefault(_x["win"], _i)
WINDOWS.sort(key=lambda w: _rank.get(w["id"], len(TODO)))     # the window picker follows the same order


def covers(win):
    """Prism's own covers on a window, from calls.log: [[start, end], ...] in seconds of the day."""
    path = os.path.join(ROOT, "calls.log")
    spans, up = [], None
    if not os.path.exists(path):
        return spans
    for line in open(path, encoding="utf-8", errors="replace"):
        t = line[:8]
        if not re.match(r"\d\d:\d\d:\d\d", t):
            continue
        s = int(t[:2]) * 3600 + int(t[3:5]) * 60 + int(t[6:8])
        if "brain ready" in line:
            if up is not None:
                spans.append([up, s]); up = None
            continue
        if f"break watch {win}:" not in line:
            continue
        if re.search(r": break \(|covered again", line) and up is None:
            up = s
        elif re.search(r": show \(|said Not an ad", line) and up is not None:
            spans.append([up, s]); up = None
    if up is not None:
        spans.append([up, 24 * 3600])
    return spans


def asked():
    """The stretches asked for by hand on this page's day (marking-todo.json beside this script)."""
    try:
        day = os.path.basename(ROOT.rstrip("\\/"))
        return [e for e in json.load(open(os.path.join(HERE, "marking-todo.json"), encoding="utf-8")) if e.get("day") == day]
    except (OSError, ValueError):
        return []


def blind_spans(win):
    """Where a window is marked blind, [[from s, to s]]: an exam hour ("blind": true in marking-todo.json). Prism's covers and the
    suggestions are left out there and shown everywhere else, so one page serves an exam hour and a training stretch alike
    (2026-10-09; --blind still hides them for the whole day)."""
    return [[sec(e["from"].replace(":", "")), sec(e["to"].replace(":", ""))] for e in asked() if e.get("window") == win and e.get("blind")]


def shown_covers(win):
    if BLIND:
        return []
    bs = blind_spans(win)
    return [c for c in covers(win) if not any(c[0] < b and c[1] > a for a, b in bs)]


def suggestions():
    """The model's suggested breaks (suggest.json, prefill.py), and on a stretch asked for with "suggest": true Prism's own covers as
    suggestions too (runs of cover 45 s or longer, pieces under 20 s apart joined) - a training stretch is then a check of each break's
    two edges, not a search. Nothing inside a blind stretch."""
    if BLIND:
        return {"windows": {}}
    sp = os.path.join(ROOT, "suggest.json")
    try:
        doc = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else {"windows": {}}
    except ValueError:
        doc = {"windows": {}}
    wins = doc.setdefault("windows", {})
    for e in asked():
        if not e.get("suggest"):
            continue
        a, b = sec(e["from"].replace(":", "")), sec(e["to"].replace(":", ""))
        runs = []
        for u, v in covers(e["window"]):
            if v <= a or u >= b:
                continue
            if runs and u - runs[-1][1] < 20:
                runs[-1][1] = v
            else:
                runs.append([u, v])
        have = wins.setdefault(e["window"], [])
        have.extend([hms(u), hms(v), 0.8] for u, v in runs if v - u >= 45)
    for w in list(wins):
        bs = blind_spans(w)
        wins[w] = sorted((s for s in wins[w] if not any(sec(s[0].replace(":", "")) < y and sec(s[1].replace(":", "")) > x for x, y in bs)), key=lambda s: s[0])
    return doc


def load_labels():
    if os.path.exists(LABELS):
        return json.load(open(LABELS, encoding="utf-8"))
    return {"windows": {}}


def save_labels(doc):
    # the scorecard's format (rates.py): from/to cover every window's marked stretch; "reviewed" is what the person has looked through
    froms, tos = [], []
    for w in doc.get("windows", {}).values():
        for a, b in w.get("reviewed", []):
            froms.append(a); tos.append(b)
    if froms:
        doc["from"], doc["to"] = min(froms), max(tos)
        doc.setdefault("since", doc["from"])
    tmp = LABELS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    os.replace(tmp, LABELS)


PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Break marks</title>
<style>
:root{--bg:#0B0D11;--panel:#14171C;--line:#2C333E;--ink:#E8ECF2;--dim:#8A93A2;--amber:#F2B14C;--green:#4CC38A;--grey:#6B7280}
*{box-sizing:border-box}html,body{overflow-x:hidden}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
button,select{background:#1E232B;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer}
button.on{border-color:var(--amber);color:var(--amber)}
#help{color:var(--dim);font-size:13px;flex-basis:100%}
#bar{position:relative;height:24px;background:#1E232B;border-radius:4px;flex-basis:100%;cursor:pointer;overflow:hidden}
#bar b{position:absolute;top:-2px;bottom:-2px;border:2px solid #fff;border-radius:3px;pointer-events:none}
#slide{flex-basis:100%;width:100%;margin:0;accent-color:var(--amber);height:28px}
#bar i{position:absolute;top:0;height:100%}
main{display:flex;gap:16px;padding:12px 16px 40px;min-width:0}#grid{min-width:0}
#grid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:6px}
.f{position:relative;cursor:pointer;border:2px solid transparent;border-radius:4px;overflow:hidden;background:#000}
.f img{display:block;width:100%;aspect-ratio:16/9}
.f span{position:absolute;left:4px;bottom:3px;font-size:12px;background:rgba(0,0,0,.65);padding:0 4px;border-radius:3px}
.f.prism{border-top-color:var(--amber)}
.f.ad{border-color:var(--green)}.f.ad img{opacity:.75}
.f.unsure{border-color:var(--grey)}
.f.pend{border-color:#fff}
.f.sug{outline:2px dashed #5AA9FF;outline-offset:-4px}
.row.sug{border-color:#5AA9FF}
#stick{position:sticky;top:var(--hh,0px);z-index:6;display:flex;flex-direction:column}
#sugbar{background:#13263D;border-bottom:2px solid #5AA9FF;display:none;flex-direction:column;gap:8px;padding:10px 12px}
#sugtext{font-weight:600;font-size:15px;line-height:1.3}
#sugbtns{display:flex;gap:8px}
#sugbtns button{flex:1;min-height:44px;font-size:15px;padding:6px 4px}
#sugok{border-color:var(--green)!important;color:var(--green)}

aside{width:300px;flex:none}
aside h3{margin:4px 0 8px;font-size:15px}
.row{display:flex;gap:6px;align-items:center;margin:4px 0;padding:6px;border:1px solid var(--line);border-radius:6px}
.row b{flex:1;font-weight:500}.row button{padding:2px 7px}
#status{color:var(--amber)}
#note{background:var(--amber);color:#111;padding:8px 8px 8px 14px;border-radius:20px;font-weight:600;display:none;pointer-events:none;margin:6px 16px 0;align-self:flex-start}
#note button{pointer-events:auto;margin-left:10px;background:#111;color:var(--amber);border:0;border-radius:14px;padding:4px 10px}
#helpbtn{display:none}
@media (max-width:800px){header{position:static}main{flex-direction:column;padding:8px}aside{width:auto}#grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
 header{padding:8px;gap:6px}button,select{padding:5px 8px;font-size:13px}#help{display:none}#help.open{display:block}#helpbtn{display:inline-block}}
</style></head><body>
<header>
<select id="todo" title="What to mark, the most useful first. Choosing one opens its window at the first frames not yet looked through"></select>
<select id="win"></select>
<button data-step="10">every 10 s</button><button data-step="4">4 s</button><button data-step="1">1 s</button>
<button id="unsure">Mark as not sure</button>
<button id="prev">&larr; earlier</button><button id="next">later &rarr;</button>
<button id="helpbtn">How to mark</button><span id="pos"></span><span id="status"></span>
<div id="bar" title="The whole recording: amber = Prism covered, green = your breaks, white = the frames on screen. Tap to jump"></div>
<input id="slide" type="range" min="0" max="1000" value="0" aria-label="Where in the recording">
<button id="pcov">&#9666; cover</button><button id="ncov">cover &#9656;</button><button id="psug">&#9666; suggestion</button><button id="nsug">suggestion &#9656;</button><span id="slidetime"></span>
<div id="help">Click the <b>first frame of the break</b> (the first that is not the show), then the <b>last frame before the show is back</b>. The whole break is one mark: no need to mark each ad. The network's own promos inside a break are part of it. A banner over the show, and a "The following program is rated" card, are the show. Amber top edge = Prism covered it. Blue dashes = the model's suggested break: Accept it, or tap Not an ad; if its edges are off, mark it yourself. Use 1 s near an edge.</div>
</header>
<div id="stick"><div id="sugbar"><div id="sugtext"></div><div id="sugbtns"><button id="sugok">Yes, ads</button><button id="sugno">No, the show</button><button id="sugnext">Skip &#9656;</button></div></div>
<div id="note"><span id="notetext"></span><button id="notecancel">Cancel</button></div></div>
<main><div id="grid"></div><aside><h3>Breaks on this window</h3><div id="list"></div></aside></main>
<script>
const $=s=>document.querySelector(s);let W=[],win=null,step=4,start=0,pend=null,unsure=false,labels={windows:{}},covers=[],SUG={};
const PAGE=96;
const hms=t=>{t=Math.round(t);return String(Math.floor(t/3600)).padStart(2,'0')+':'+String(Math.floor(t/60)%60).padStart(2,'0')+':'+String(t%60).padStart(2,'0')};
const sec=n=>+n.slice(0,2)*3600+ +n.slice(2,4)*60+ +n.slice(4,6)+(n.length>=9?+n.slice(6,9)/1000:0);
const toS=h=>{const p=h.split(':');return +p[0]*3600+ +p[1]*60+ +p[2]};
function L(){const l=labels.windows[win.id]||(labels.windows[win.id]={name:win.name,ads:[],neutral:[],reviewed:[]});l.dismissed=l.dismissed||[];l.show=l.show||[];return l}
// the model's suggested breaks not yet decided: not dismissed, and not already marked over most of their length
function pendingSug(){const l=L();return (SUG[win.id]||[]).filter(([a,b])=>!l.dismissed.some(d=>d[0]===a&&d[1]===b)&&!l.ads.some(([x,y])=>toS(x)<=toS(b)&&toS(y)>=toS(a)))}
async function save(){const r=await fetch('/api/labels',{method:'POST',body:JSON.stringify(labels)});$('#status').textContent=r.ok?'saved':'not saved: '+r.status;setTimeout(()=>$('#status').textContent='',1500);fillTodo()}
// what to mark next, the most useful first: how much of each stretch has been looked through, and where its first unseen frames are
let T=[];
function spansOf(x){const l=labels.windows[x.win];return ((l&&l.reviewed)||[]).map(r=>[toS(r[0]),toS(r[1])]).sort((p,q)=>p[0]-q[0])}
function doneOf(x){const a=toS(x.from),b=toS(x.to);let s=0;for(const [u,v] of spansOf(x))s+=Math.max(0,Math.min(b,v)-Math.max(a,u));return Math.min(1,s/Math.max(1,b-a))}
function firstOpen(x){let t=toS(x.from);for(const [u,v] of spansOf(x))if(u<=t+1&&v>t)t=v;return Math.min(t,toS(x.to))}
function fillTodo(){const s=$('#todo');if(!s)return;const keep=s.value;s.innerHTML='';const h=document.createElement('option');h.value='';h.textContent=T.length?'Next to mark (most useful first)':'Nothing listed to mark';s.appendChild(h);
  const rows=T.map((x,i)=>[x,i,Math.round(100*doneOf(x))]);
  for(const [x,i,d] of [...rows.filter(r=>r[2]<97),...rows.filter(r=>r[2]>=97)]){const o=document.createElement('option');o.value=i;
    o.textContent=(d>=97?'done · ':(i+1)+'. ')+x.name+' '+x.from.slice(0,5)+' to '+x.to.slice(0,5)+(x.why?' · '+x.why:'')+(d>0&&d<97?' · '+d+'% looked through':'');s.appendChild(o)}
  s.value=keep}
function times(){const out=[];let last=-1e9;for(const n of win.frames){const t=sec(n);if(t-last>=step-0.25){out.push([n,t]);last=t}}return out}
function inSpan(t,L){return L.some(([a,b])=>toS(a)<=t&&t<=toS(b)+0.99)}
function draw(){
  const all=times();start=Math.max(0,Math.min(start,all.length-1));const page=all.slice(start,start+PAGE);
  const l=L();const g=$('#grid');g.innerHTML='';
  for(const [n,t] of page){const d=document.createElement('div');d.className='f';
    if(covers.some(([a,b])=>a<=t&&t<b))d.classList.add('prism');
    if(inSpan(t,l.ads))d.classList.add('ad');if(inSpan(t,l.neutral))d.classList.add('unsure');
    if(pendingSug().some(([a,b])=>toS(a)<=t&&t<=toS(b)+0.99))d.classList.add('sug');
    if(pend&&pend.n===n)d.classList.add('pend');
    d.innerHTML='<img loading="lazy" src="/img/'+win.id+'/'+n+'"><span>'+hms(t)+'</span>';d.onclick=()=>pick(n,t);g.appendChild(d)}
  if(page.length){const a=page[0][1],b=page[page.length-1][1];$('#pos').textContent=hms(a)+' to '+hms(b);
    const rv=l.reviewed;const lo=Math.floor(a),hi=Math.ceil(b);rv.push([hms(lo),hms(hi)]);l.reviewed=merge(rv)}
  list();bar();sugBar(page)}
// the suggestion on screen (or the next one) in a bar at the foot, so a phone never scrolls to the list to decide it
function sugBar(page){const sb=$('#sugbar');const ps=pendingSug();if(!page.length||!ps.length){sb.style.display='none';return}
  const a0=page[0][1],b0=page[page.length-1][1];const cur=ps.find(([a,b])=>toS(a)<=b0&&toS(b)>=a0)||ps.find(([a])=>toS(a)>a0)||ps[0];
  sb.style.display='flex';const here=toS(cur[0])<=b0&&toS(cur[1])>=a0;
  $('#sugtext').textContent=here?'Are the blue-outlined frames ('+cur[0]+' to '+cur[1]+') an ad break?':'The model thinks '+cur[0]+' to '+cur[1]+' is an ad break';
  $('#sugok').style.display=here?'':'none';$('#sugno').style.display=here?'':'none';$('#sugnext').innerHTML=here?'Skip &#9656;':'Show me &#9656;';
  $('#sugok').onclick=()=>{const l=L();l.ads.push([cur[0],cur[1]]);l.ads=merge(l.ads);l.reviewed=merge([...l.reviewed,[hms(toS(cur[0])-30),hms(toS(cur[1])+30)]]);save();nearSug(1)||draw()};
  $('#sugno').onclick=()=>{const l=L();l.dismissed.push([cur[0],cur[1]]);l.show.push([cur[0],cur[1]]);l.reviewed=merge([...l.reviewed,[cur[0],cur[1]]]);save();nearSug(1)||draw()};
  $('#sugnext').onclick=()=>{if(toS(cur[0])>a0+20||toS(cur[1])<a0)jump(toS(cur[0])-12);else nearSug(1)}}
function merge(L){const s=L.map(([a,b])=>[toS(a),toS(b)]).sort((x,y)=>x[0]-y[0]);const o=[];for(const [a,b] of s){if(o.length&&a<=o[o.length-1][1]+2)o[o.length-1][1]=Math.max(o[o.length-1][1],b);else o.push([a,b])}return o.map(([a,b])=>[hms(a),hms(b)])}
function pick(n,t){if(!pend){pend={n,t};$('#notetext').textContent=hms(t)+' set. Now tap the '+(unsure?'other end of the unsure stretch':'other end of the break');$('#note').style.display='flex';draw();return}
  $('#note').style.display='none';
  let a=Math.min(pend.t,t),b=Math.max(pend.t,t);pend=null;const l=L();(unsure?l.neutral:l.ads).push([hms(a),hms(b)]);
  l.ads=merge(l.ads);l.neutral=merge(l.neutral);save();draw()}
function list(){const l=L();const el=$('#list');el.innerHTML='';
  const rows=[...l.ads.map(x=>['break',x]),...l.neutral.map(x=>['not sure',x])].sort((p,q)=>toS(p[1][0])-toS(q[1][0]));
  for(const [k,[a,b]] of rows){const r=document.createElement('div');r.className='row';
    r.innerHTML='<b>'+(k==='not sure'?'Not sure ':'')+a+' to '+b+'</b>';
    const go=document.createElement('button');go.textContent='Go';go.onclick=()=>jump(toS(a)-8);
    const del=document.createElement('button');del.textContent='Remove';del.onclick=()=>{const L2=L();const arr=k==='break'?L2.ads:L2.neutral;const i=arr.findIndex(x=>x[0]===a&&x[1]===b);if(i>=0)arr.splice(i,1);save();draw()};
    r.append(go,del);el.appendChild(r)}
  for(const [a,b,c] of pendingSug()){const r=document.createElement('div');r.className='row sug';
    r.innerHTML='<b>Suggested '+a+' to '+b+'</b>';
    const go=document.createElement('button');go.textContent='Go';go.onclick=()=>jump(toS(a)-8);
    const ok=document.createElement('button');ok.textContent='Accept';ok.onclick=()=>{const l=L();l.ads.push([a,b]);l.ads=merge(l.ads);l.reviewed=merge([...l.reviewed,[hms(toS(a)-30),hms(toS(b)+30)]]);save();draw()};
    const no=document.createElement('button');no.textContent='Not an ad';no.onclick=()=>{const l=L();l.dismissed.push([a,b]);l.show.push([a,b]);l.reviewed=merge([...l.reviewed,[a,b]]);save();draw()};
    r.append(go,ok,no);el.appendChild(r)}
  if(!rows.length&&!pendingSug().length)el.innerHTML='<div style="color:var(--dim)">None yet</div>'}
function jump(t){const all=times();let i=all.findIndex(([n,x])=>x>=t);start=Math.max(0,i<0?all.length-1:i);draw();scrollTo(0,0)}
function bar(){const b=$('#bar');b.innerHTML='';const t0=sec(win.frames[0]),t1=sec(win.frames[win.frames.length-1]),w=t1-t0||1;
  const add=(a,c,h,top)=>{a=[Math.max(a[0],t0),Math.min(a[1],t1)];if(a[1]<=a[0])return;const i=document.createElement('i');i.style.left=(100*(a[0]-t0)/w)+'%';i.style.width=Math.max(.2,100*(a[1]-a[0])/w)+'%';i.style.background=c;i.style.height=h;i.style.top=top;b.appendChild(i)};
  for(const c of covers)add(c,'var(--amber)','50%','0');for(const [a,c] of pendingSug())add([toS(a),toS(c)],'#5AA9FF','50%','50%');for(const [a,c] of L().ads)add([toS(a),toS(c)],'var(--green)','50%','50%');
  const all=times(),pg=all.slice(start,start+PAGE);
  if(pg.length){const box=document.createElement('b');box.style.left=(100*(pg[0][1]-t0)/w)+'%';box.style.width=Math.max(.6,100*(pg[pg.length-1][1]-pg[0][1])/w)+'%';b.appendChild(box);
    const sl=$('#slide');if(!sliding)sl.value=Math.round(1000*(pg[0][1]-t0)/w)}
  b.onclick=e=>{const r=b.getBoundingClientRect();jump(t0+w*(e.clientX-r.left)/r.width)}}
let sliding=false;
function slideT(){const t0=sec(win.frames[0]),t1=sec(win.frames[win.frames.length-1]);return t0+(t1-t0)*$('#slide').value/1000}
$('#slide').addEventListener('input',()=>{sliding=true;$('#slidetime').textContent=hms(slideT())});
$('#slide').addEventListener('change',()=>{sliding=false;$('#slidetime').textContent='';jump(slideT())});
function nearCover(dir){const all=times(),cur=(all[start]||all[0])[1];
  const sts=covers.map(c=>c[0]).sort((x,y)=>x-y);const t=dir>0?sts.find(x=>x>cur+10):[...sts].reverse().find(x=>x<cur+2);if(t!==undefined)jump(t-12)}
$('#pcov').onclick=()=>nearCover(-1);$('#ncov').onclick=()=>nearCover(1);
function nearSug(dir){const all=times(),cur=(all[start]||all[0])[1];const sts=pendingSug().map(x=>toS(x[0])).sort((x,y)=>x-y);
  const t=dir>0?sts.find(x=>x>cur+14):[...sts].reverse().find(x=>x<cur+2);if(t!==undefined){jump(t-12);return true}return false}
$('#psug').onclick=()=>nearSug(-1);$('#nsug').onclick=()=>nearSug(1);
async function choose(id){win=W.find(x=>x.id===id);covers=await (await fetch('/api/covers?win='+id)).json();start=0;pend=null;draw()}
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{const keep=times()[start]?.[1]??0;step=+b.dataset.step;document.querySelectorAll('[data-step]').forEach(x=>x.classList.toggle('on',x===b));jump(keep)});
$('#unsure').onclick=()=>{unsure=!unsure;$('#unsure').classList.toggle('on',unsure)};
$('#prev').onclick=()=>{start-=PAGE;draw();save();scrollTo(0,0)};$('#next').onclick=()=>{start+=PAGE;draw();save();scrollTo(0,0)};
$('#helpbtn').onclick=()=>{$('#help').classList.toggle('open');stickTop()};
function stickTop(){const h=document.querySelector('header');document.documentElement.style.setProperty('--hh',getComputedStyle(h).position==='sticky'?h.offsetHeight+'px':'0px')}
addEventListener('resize',stickTop);setTimeout(stickTop,0);
$('#notecancel').onclick=()=>{pend=null;$('#note').style.display='none';draw()};
addEventListener('keydown',e=>{if(e.key==='Escape'){pend=null;$('#note').style.display='none';draw()}if(e.key==='ArrowRight')$('#next').click();if(e.key==='ArrowLeft')$('#prev').click()});
(async()=>{W=await (await fetch('/api/windows')).json();labels=await (await fetch('/api/labels')).json();labels.windows=labels.windows||{};
  try{SUG=(await (await fetch('/api/suggest')).json()).windows||{}}catch(e){SUG={}}
  try{T=await (await fetch('/api/todo')).json()}catch(e){T=[]}fillTodo();
  $('#todo').onchange=async e=>{const x=T[+e.target.value];if(e.target.value===''||!x)return;$('#win').value=x.win;await choose(x.win);jump(firstOpen(x));fillTodo()};
  for(const w of W){const o=document.createElement('option');o.value=w.id;o.textContent=w.name+' ('+w.id.replace('youtube-tv-home-16x9-','')+')';$('#win').appendChild(o)}
  $('#win').onchange=e=>choose(e.target.value);document.querySelector('[data-step="4"]').classList.add('on');choose(W[0].id)})();
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    # one connection carries many requests (a page asks for 96 frames at once; a phone made a new connection for each one, 2026-10-07)
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send(self, code, body, ctype, cookie=None):
        if "gzip" in self.headers.get("Accept-Encoding", "") and ctype.startswith(("application/json", "text/html")) and len(body) > 1024:
            body = gzip.compress(body, 6); enc = True
        else:
            enc = False
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if enc:
            self.send_header("Content-Encoding", "gzip")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store" if ctype.startswith(("text/html", "application/json")) else "max-age=86400")
        self.end_headers()
        self.wfile.write(body)
        took = (time.perf_counter() - getattr(self, "_t0", time.perf_counter())) * 1000
        print(f"{time.strftime('%H:%M:%S')} {self.client_address[0]} {code} {self.path.split('?')[0][:60]} {len(body)}B {took:.0f}ms", flush=True)

    def parse_request(self):
        self._t0 = time.perf_counter()
        return super().parse_request()

    def allowed(self, u):
        if not LAN:
            return True
        if parse_qs(u.query).get("k", [""])[0] == KEY:
            return True
        cookie = self.headers.get("Cookie", "")
        return any(c.strip() == "k=" + KEY for c in cookie.split(";"))

    def do_GET(self):
        u = urlparse(self.path)
        if not self.allowed(u):
            return self.send(403, b"the link's key is needed", "text/plain")
        if u.path == "/":
            return self.send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8", f"k={KEY}; HttpOnly; SameSite=Strict; Path=/" if LAN else None)
        if u.path == "/api/windows":
            return self.send(200, json.dumps(WINDOWS).encode(), "application/json")
        if u.path == "/api/todo":
            return self.send(200, json.dumps(TODO).encode(), "application/json")
        if u.path == "/api/covers":
            win = parse_qs(u.query).get("win", [""])[0]
            return self.send(200, json.dumps(shown_covers(win)).encode(), "application/json")
        if u.path == "/api/labels":
            return self.send(200, json.dumps(load_labels()).encode(), "application/json")
        if u.path == "/api/suggest":
            sp = os.path.join(ROOT, "suggest.json")
            return self.send(200, json.dumps(suggestions()).encode(), "application/json")
        m = re.match(r"/img/([\w.-]+)/(\d{9})$", u.path)
        if m and any(w["id"] == m.group(1) for w in WINDOWS):
            p = os.path.join(ROOT, m.group(1), m.group(2) + ".gray")
            if os.path.exists(p):
                a = np.fromfile(p, dtype=np.uint8)
                if a.size == 320 * 180:
                    buf = io.BytesIO()
                    Image.fromarray(a.reshape(180, 320)).save(buf, "JPEG", quality=70)
                    return self.send(200, buf.getvalue(), "image/jpeg")
        self.send(404, b"not found", "text/plain")

    def do_POST(self):
        if not self.allowed(urlparse(self.path)):
            return self.send(403, b"the link's key is needed", "text/plain")
        if urlparse(self.path).path != "/api/labels":
            return self.send(404, b"not found", "text/plain")
        n = int(self.headers.get("Content-Length", "0"))
        try:
            doc = json.loads(self.rfile.read(n))
            assert isinstance(doc, dict) and isinstance(doc.get("windows"), dict)
        except Exception:
            return self.send(400, b"bad labels", "text/plain")
        save_labels(doc)
        self.send(200, b"{}", "application/json")


if __name__ == "__main__":
    print(f"marking {ROOT}: {len(WINDOWS)} windows, labels in {LABELS}")
    print(f"open http://{LAN}:{PORT}/?k={KEY}" if LAN else f"open http://127.0.0.1:{PORT}/", flush=True)
    ThreadingHTTPServer((LAN or "127.0.0.1", PORT), Handler).serve_forever()
