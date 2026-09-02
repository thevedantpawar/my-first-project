import re, json, csv, datetime as dt
SP="/tmp/claude-0/-home-user-my-first-project/eb291d7c-ea41-5811-8ce3-909c4805a2a1/scratchpad/"
hand=json.load(open(SP+"handwritten.json"))
by_email={}
for x in hand: by_email.setdefault(x["email"].lower(), x)
by_email["info@artistikbeautyfl.com"]=by_email["info@artistikbeauty.net"]  # workbook domain is wrong

# ---------- gated file (63), keyed by rank ----------
g=open("handwritten_p6_gated.md").read()
gated={}
for name,tag in (("A","# SECTION A"),("B","# SECTION B"),("C","# SECTION C")):
    txt=g.split(tag)[1].split("\n---\n")[0]
    for m in re.finditer(r"^\*\*(\d+)\s*·\s*(.+?)\*\*\s*·\s*(.*?)Subject:\s*\*(.+?)\*\s*\n(.*?)(?=\n\n\*\*\d+\s*·|\Z)", txt, re.S|re.M):
        rank,biz,meta,subj,body=m.groups()
        gated[int(rank)]=dict(section=name,subject=subj.strip(),body=body.strip())
assert len(gated)==63, len(gated)
GST={"A":"VERIFY ADDRESS BEFORE SEND","B":"DO NOT SEND — address on file is unusable",
     "C":"HOLD — chain duplicate, Pool 5 owns the network"}

# ---------- follow-up library ----------
lib={}
for blk in open("followup_library.md").read().split("\n## SEGMENT: ")[1:]:
    seg=blk.split(" ")[0].strip()
    touches={}
    for m in re.finditer(r"\*\*T(\d) · day \d+ · (.+?)\*\*\n(.+?)(?=\n\n|\Z)", blk, re.S):
        touches[int(m.group(1))]=(m.group(2).strip(), " ".join(m.group(3).split()))
    lib[seg]=touches
assert set(lib)>= {"coverage","reviews","qualification","membership","packages","multi-site","early"}, lib.keys()

def segment(subj, body, reviews, pool, business):
    s=subj.lower(); b=body.lower()
    if re.search(r"\b(partial fit|wrong fit|not a fit|probably not a fit)\b", s) or \
       b.startswith(("straight with you","being straight","straight version")):
        return "wrong-fit"
    if re.search(r"location routing|pilot|one conversation|per-location|bartram|rea farms|west u", s) or \
       re.search(r"locations|network|franchise|corporate|every site", b[:400]):
        return "multi-site"
    if re.search(r"review|rating|bbb", s): return "reviews"
    if "membership" in s or "membership" in b[:200]: return "membership"
    if re.search(r"package|laser", s): return "packages"
    if re.search(r"triage|consult|qualif|people\b|solo practice|scan inquir", s): return "qualification"
    try: rv=int(reviews)
    except: rv=0
    if rv < 30: return "early"
    return "coverage"

rows=list(csv.DictReader(open("MASTER_send_list.csv")))
out=[]
from collections import Counter
stat=Counter(); segs=Counter()
for r in rows:
    rank=int(r["Rank"]); em=r["Email"].strip().lower()
    if rank in gated:
        gg=gated[rank]; subj, body, status, src = gg["subject"], gg["body"], GST[gg["section"]], "handwritten_p6_gated.md"
    else:
        h=by_email[em]; subj, body, status, src = h["subject"], h["body"], "SEND", h["src"]
    body=" ".join(body.split())
    if "⚠ DO NOT SEND" in body:
        status="DO NOT SEND — address on file is unusable"
        body=re.split(r"[Cc]opy is ready below\.\**\s*", body, maxsplit=1)[-1].strip()
    seg=segment(subj, body, r["Reviews"], r["Pool"], r["Business"])
    stat[status]+=1; segs[seg]+=1
    o=dict(r)
    o["Send status"]=status; o["Sequence segment"]=seg
    o["T1 subject"]=subj; o["T1 body"]=body
    o["T1 source"]=src; o["T1 words"]=len(body.split())
    for t in (2,3,4,5):
        if seg=="wrong-fit":
            o[f"T{t} subject"]=""; o[f"T{t} body"]="— single touch only, no follow-up (honest non-pitch)"
        else:
            s2,b2=lib[seg][t]; o[f"T{t} subject"]=s2; o[f"T{t} body"]=b2
    o["Cadence"]="T1 day 0 · T2 day 3 · T3 day 7 · T4 day 14 · T5 day 21" if seg!="wrong-fit" else "single touch"
    out.append(o)

# ---------- schedule: Tue-Thu only, warm-up ramp ----------
def send_days(start):
    d=start
    while True:
        if d.weekday() in (1,2,3): yield d
        d+=dt.timedelta(days=1)
caps=[20,20,20,25,25,25,30,30,30]+[40]*40
gen=send_days(dt.date(2026,9,8))
sendable=[o for o in out if o["Send status"]=="SEND"]
i=0; wave=0
for cap in caps:
    if i>=len(sendable): break
    day=next(gen); wave+=1
    for o in sendable[i:i+cap]:
        o["Wave"]=wave; o["T1 send date"]=day.isoformat()+" ("+day.strftime("%a")+", 9–11am local)"
    i+=cap
for o in out:
    o.setdefault("Wave",""); o.setdefault("T1 send date","— gated, see Send status")

flds=["Rank","Pool","Send status","Sequence segment","Wave","T1 send date","Cadence",
      "Business","City","ST","Email","Phone","Website","Rating","Reviews","Employees","Segment",
      "Coverage gap","Lead with","Warnings","T1 subject","T1 body","T1 words","T1 source",
      "T2 subject","T2 body","T3 subject","T3 body","T4 subject","T4 body","T5 subject","T5 body"]
with open("MASTER_send_list.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=flds,extrasaction="ignore"); w.writeheader(); w.writerows(out)

print("rows:",len(out)); print()
for k,v in stat.most_common(): print(f"  {v:4d}  {k}")
print()
for k,v in segs.most_common(): print(f"  {v:4d}  {k}")
ws=[o["T1 words"] for o in out]
print("\nT1 words: min",min(ws),"median",sorted(ws)[len(ws)//2],"max",max(ws))
print("waves:",wave,"last send date:",max(o["T1 send date"] for o in sendable))
print("total emails scheduled:", sum(1 for o in out if o["Send status"]=="SEND") + sum(4 for o in out if o["Send status"]=="SEND" and o["Sequence segment"]!="wrong-fit"))
