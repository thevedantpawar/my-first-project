import csv, collections, hashlib
raw=list(csv.DictReader(open('leads_raw.csv',encoding='utf-8')))
have={r['Email'].split('@')[-1].lower() for r in csv.DictReader(open('medspa_qualified_leads_enriched.csv',encoding='utf-8'))}
def num(v,d=0.0):
    try: return float(v)
    except: return d

cand=[r for r in raw if r['Tier']=='A' and r.get('Phone') and num(r['Rating'])>=4.0
      and 100<=num(r['Reviews'])<150 and r['Email'].split('@')[-1].lower() not in have]
seen=set(); pool=[]
for r in sorted(cand,key=lambda x:-num(x['Reviews'])):
    d=r['Email'].split('@')[-1].lower()
    if d in seen: continue
    seen.add(d); pool.append(r)
print("POOL 2 SIZE:",len(pool))

def cs(r): return set(x for x in (r.get('Closed days') or '').split(';') if x)
def h(r,n):  # stable per-lead variant picker
    return int(hashlib.md5((r['Business']+r['Email']).encode()).hexdigest(),16)%n

SUBJ={
 'weekend':['weekend calls','weekend coverage','weekend voicemail','saturday calls'],
 'sunday' :['sunday calls','sunday coverage','sunday voicemail'],
 'monday' :['monday backlog','midweek gap','two dark days'],
 'other'  :['front desk','after hours','missed calls'],
 'review' :['review replies','unanswered reviews'],
}
def bucket(r):
    if num(r['Rating'])<4.6: return 'review'
    c=cs(r)
    if {'Saturday','Sunday'}<=c: return 'weekend'
    if 'Sunday' in c and len(c)>1: return 'monday'
    if 'Sunday' in c: return 'sunday'
    if c: return 'monday'
    return 'other'

def opener(r,b):
    n=r['Business'].split('|')[0].strip(); rv=int(num(r['Reviews'])); rt=r['Rating']; c=r['City']
    v=h(r,3); cl=sorted(cs(r))
    if b=='review':
        return [f"{rt} across {rv} reviews is a solid practice with a visible gap — the critical ones look unanswered, and that's what a new patient reads first.",
                f"You're at {rt} on {rv} reviews. For a clinic your size that's usually not a service problem, it's a follow-up problem.",
                f"{rv} reviews at {rt}. The gap between that and a 4.9 down the street is almost always unanswered criticism, not worse treatment."][v]
    if b=='weekend':
        return [f"{rv} reviews at {rt}, and the calendar shows both Saturday and Sunday dark. That's two days a week of {c} calls going to voicemail.",
                f"Closed Saturday and Sunday against {rv} reviews — whoever calls this weekend books somewhere else by Monday.",
                f"Both weekend days closed. At {rv} reviews, that's a real number of {c} inquiries you never hear about."][v]
    if b=='sunday':
        return [f"{rv} reviews at {rt}, and Sunday still shows dark on the calendar.",
                f"Sunday's closed, and {rv} reviews says people are still calling on Sunday.",
                f"At {rv} reviews demand clearly isn't your problem — but Sunday callers get voicemail."][v]
    if b=='monday':
        days=', '.join(cl) if cl else 'those days'
        return [f"Closed {days}. Everything from those days lands at once on the next morning, on the same team.",
                f"You're closed {days} — the calls don't stop, they just pile up for the next open day.",
                f"{rv} reviews at {rt}, closed {days}. Two dark days is a lot of inbound arriving together."][v]
    return [f"{rv} reviews at {rt} means the phone rarely stops at {n}.",
            f"{rv} reviews is a lot of traffic through one front desk.",
            f"At {rv} reviews, your front desk is fielding more calls than it can book."][v]

def middle(r,b):
    v=h(r,2)
    if b=='review':
        return ["Review requests can fire on a real treatment-completed event rather than a blast, with replies drafted for a manager to approve before anything posts. Public auto-posting stays off by default — replying to a review confirms that person was a patient, and that's a human's call.",
                "Requests fire on an actual treatment-completed event, and replies come back AI-drafted for approval. Nothing posts publicly without a person signing off, because a public reply confirms someone was a patient."][v]
    return ["An agent covering those hours answers, quotes your real prices instead of deflecting to a callback, and books into your calendar as pending so your team still confirms every slot. Anything clinical it won't touch — that routes to a provider callback on a tracked two-hour clock.",
            "An agent covers the hours you can't. It quotes real pricing, books as pending so a human still confirms, and refuses clinical questions outright — those route to a provider callback within two hours, tracked and escalated if missed."][v]

CTA=['Worth exploring?','Worth a look?','Useful?','Worth a short conversation?']

rows=[]
for r in pool:
    b=bucket(r)
    body=f"{opener(r,b)}\n\n{middle(r,b)}\n\n{CTA[h(r,4)]}"
    rows.append({'Business':r['Business'],'City':r['City'],'ST':r['ST'],'Email':r['Email'],
                 'Phone':r['Phone'],'Website':r['Website'],'Rating':r['Rating'],'Reviews':r['Reviews'],
                 'Coverage gap':', '.join(sorted(cs(r))) or 'hours not listed',
                 'Lead with':'Review request + AI replies' if b=='review' else 'Receptionist / voice agent',
                 'Subject':SUBJ[b][h(r,len(SUBJ[b]))],'Email body':body})
rows.sort(key=lambda x:-num(x['Reviews']))
with open('pool2_leads_100plus.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print("WROTE", len(rows))
print("subjects used:", dict(collections.Counter(x['Subject'] for x in rows)))
print("lead-with     :", dict(collections.Counter(x['Lead with'] for x in rows)))
print("states        :", collections.Counter(x['ST'] for x in rows).most_common(6))
print("\nsample:"); print(rows[0]['Business'],'|',rows[0]['Subject']); print(rows[0]['Email body'][:200])
