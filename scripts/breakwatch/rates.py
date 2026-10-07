import re,os,sys,json
LOG=os.environ.get("LOGF") or os.path.join(os.environ["LOCALAPPDATA"],"Prism","diagnostics","host.log")
def s(t): h,m,x=t.split(":"); return int(h)*3600+int(m)*60+int(x)
spec=json.load(open(sys.argv[1])); FROM,TO,SINCE=s(spec["from"]),s(spec["to"]),spec["since"]
calls={}
for line in open(LOG,encoding="utf-8",errors="replace"):
    m=re.match(r"(\d\d:\d\d:\d\d)\.\d+ break watch (\S+): (break|show) \(",line)
    if m and m.group(1)>=SINCE: calls.setdefault(m.group(2),[]).append((s(m.group(1)),m.group(3)=="break"))
T=[0,0,0,0]
for w,lab in spec["windows"].items():
    def cov(t):
        st=False
        for ct,b in calls.get(w,[]):
            if ct<=t: st=b
        return st
    ad=adc=sh=shc=0; runs=[]; cur=None; late=[]
    for a,b in lab.get("ads",[]):
        first=next((t for t in range(s(a),s(b),1) if cov(t)),None); late.append(None if first is None else first-s(a))
    for t in range(FROM,TO,2):
        inr=lambda L:any(s(a)<=t<s(b) for a,b in L); c=cov(t)
        if inr(lab.get("neutral",[])): 
            if cur is not None: runs.append(t-cur); cur=None
            continue
        if inr(lab.get("ads",[])):
            ad+=1; adc+=c
            if cur is not None: runs.append(t-cur); cur=None
        else:
            sh+=1; shc+=c
            if c and cur is None: cur=t
            if not c and cur is not None: runs.append(t-cur); cur=None
    if cur is not None: runs.append(TO-cur)
    print(f"{lab['name']:12s} ads covered {adc*2:4d}/{ad*2:4d} s  covered after {late} s   show wrongly covered {shc*2:4d}/{sh*2:4d} s {runs if runs else ''}")
    T[0]+=ad;T[1]+=adc;T[2]+=sh;T[3]+=shc
print(f"ALL  ads covered {100*T[1]/max(1,T[0]):.0f}%  ({T[1]*2}/{T[0]*2} s)   show wrongly covered {100*T[3]/max(1,T[2]):.1f}%  ({T[3]*2}/{T[2]*2} s)")
