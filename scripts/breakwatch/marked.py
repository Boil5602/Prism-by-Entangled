"""Contact sheets of a window's frames with the LIVE break watch's calls marked: a white bar on top = covered."""
import os,sys,glob,re,numpy as np
from PIL import Image,ImageDraw
ROOT=os.path.join(os.environ["LOCALAPPDATA"],"Prism","diagnostics")
win,frm,to=sys.argv[1],sys.argv[2],sys.argv[3]; step=int(sys.argv[4]) if len(sys.argv)>4 else 3
calls=[]
for line in open(os.path.join(ROOT,"host.log"),encoding="utf-8",errors="replace"):
    m=re.match(r"(\d\d):(\d\d):(\d\d)\.\d+ break watch "+re.escape(win)+r": (break|show) \(",line)
    if m and m.group(1)+m.group(2)+m.group(3)>=os.environ.get("SINCE","000000"): calls.append((m.group(1)+m.group(2)+m.group(3),m.group(4)=="break"))
def covered(t):
    st=False
    for ct,b in calls:
        if ct<=t: st=b
    return st
files=[f for f in sorted(glob.glob(os.path.join(ROOT,"bench",win,"*.gray"))) if frm<=os.path.basename(f)[:6]<=to][::step]
cols=8; tw,th=200,112; per=48
for s0 in range(0,len(files),per):
    chunk=files[s0:s0+per]; rows=(len(chunk)+cols-1)//cols
    sheet=Image.new("L",(cols*tw,rows*(th+16)),0); d=ImageDraw.Draw(sheet)
    for k,f in enumerate(chunk):
        a=np.fromfile(f,np.uint8)
        if a.size!=320*180: continue
        t=os.path.basename(f)[:6]; x=(k%cols)*tw; y=(k//cols)*(th+16)
        sheet.paste(Image.fromarray(a.reshape(180,320)).resize((tw,th)),(x,y+16))
        c=covered(t)
        if c: d.rectangle([x,y,x+tw-2,y+14],fill=255)
        d.text((x+3,y+2),t[:2]+":"+t[2:4]+":"+t[4:]+("  COVERED" if c else ""),fill=0 if c else 255)
    out=f"sheets/m{win[-3:]}_{os.path.basename(chunk[0])[:6]}.png"; sheet.save(out); print(out)
