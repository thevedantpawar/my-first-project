import csv, collections, hashlib
raw=list(csv.DictReader(open('leads_raw.csv',encoding='utf-8')))
def num(v,d=0.0):
    try: return float(v)
    except: return d
b=[r for r in raw if r['Tier']=='B']
print("TIER B TOTAL:",len(b))
print("providers:",dict(collections.Counter(r['Email'].split('@')[-1].lower() for r in b)))
print("reviews>=100:",len([r for r in b if num(r['Reviews'])>=100]),
      " >=50:",len([r for r in b if num(r['Reviews'])>=50]),
      " >=150:",len([r for r in b if num(r['Reviews'])>=150]))
print("rating<4.0:",len([r for r in b if num(r['Rating'])<4.0]))
print("no phone:",len([r for r in b if not r['Phone']]))

# looks-like-a-person vs looks-like-a-business local part
def personal(e):
    lp=e.split('@')[0].lower()
    return '.' in lp or any(c.isdigit() for c in lp) is False and len(lp)<=12
pool=[r for r in b if num(r['Rating'])>=4.0 and num(r['Reviews'])>=100 and r['Phone']]
seen=set(); out=[]
for r in sorted(pool,key=lambda x:-num(x['Reviews'])):
    k=r['Email'].lower()
    if k in seen: continue
    seen.add(k); out.append(r)
print("\nPOOL 3 (rating>=4.0, reviews>=100, has phone):",len(out))

def cs(r): return set(x for x in (r.get('Closed days') or '').split(';') if x)
def h(r,n): return int(hashlib.md5((r['Business']+r['Email']).encode()).hexdigest(),16)%n
SUBJ={'weekend':['weekend calls','weekend coverage','weekend voicemail'],
      'sunday':['sunday calls','sunday coverage','sunday voicemail'],
      'monday':['monday backlog','two dark days','midweek gap'],
      'other':['front desk','after hours','missed calls'],
      'review':['review replies','unanswered reviews']}
def bucket(r):
    if num(r['Rating'])<4.6: return 'review'
    c=cs(r)
    if {'Saturday','Sunday'}<=c: return 'weekend'
    if 'Sunday' in c and len(c)>1: return 'monday'
    if 'Sunday' in c: return 'sunday'
    if c: return 'monday'
    return 'other'

# Tier B = owner's personal inbox. Shorter, plainer, more direct than the Tier A copy.
def body(r,b_):
    rv=int(num(r['Reviews'])); rt=r['Rating']; c=r['City']; v=h(r,3); cl=sorted(cs(r))
    if b_=='review':
        op=[f"{rt} across {rv} reviews, and the critical ones look unanswered.",
            f"You're at {rt} on {rv} reviews — the gap is usually unanswered criticism, not worse treatment.",
            f"{rv} reviews at {rt}. The negative ones are doing more work than they should."][v]
        mid="Review requests fire after a treatment actually completes, and replies come back drafted for you to approve. Nothing posts publicly without you — a public reply confirms someone was a patient."
    elif b_=='weekend':
        op=[f"Both weekend days closed against {rv} reviews. Whoever calls Saturday books somewhere else by Monday.",
            f"{rv} reviews at {rt}, and the weekend is dark. That's two days of {c} calls nobody hears.",
            f"Closed Saturday and Sunday. At {rv} reviews that's a lot of missed inbound."][v]
        mid="An agent answers those hours, quotes your real prices, and books as pending so you confirm before anything is real. Clinical questions it won't touch — those go to a provider callback."
    elif b_=='sunday':
        op=[f"{rv} reviews at {rt}, Sunday still dark.",
            f"Sunday's closed, and {rv} reviews says people still call on Sunday.",
            f"At {rv} reviews you're not short on demand — Sunday callers just get voicemail."][v]
        mid="An agent covers Sunday, quotes real pricing, and books as pending so you confirm. It refuses anything clinical."
    elif b_=='monday':
        d=', '.join(cl) if cl else 'those days'
        op=[f"Closed {d} — the calls don't stop, they pile up for the next open day.",
            f"You're closed {d}. Everything lands at once the next morning.",
            f"{rv} reviews at {rt}, closed {d}. Two dark days is a lot arriving together."][v]
        mid="An agent works the queue as it arrives instead of letting it stack, and books as pending so you confirm."
    else:
        op=[f"{rv} reviews at {rt} means your phone rarely stops.",
            f"{rv} reviews is a lot of traffic through one front desk.",
            f"At {rv} reviews you're fielding more calls than you can book."][v]
        mid="An agent answers what you can't, quotes real prices, and books as pending so you confirm."
    return f"{op}\n\n{mid}\n\n{['Worth a look?','Worth exploring?','Useful?'][h(r,3)]}"

rows=[]
for r in out:
    bk=bucket(r)
    rows.append({'Business':r['Business'],'City':r['City'],'ST':r['ST'],'Email':r['Email'],
                 'Provider':r['Email'].split('@')[-1].lower(),'Phone':r['Phone'],'Website':r['Website'],
                 'Rating':r['Rating'],'Reviews':r['Reviews'],
                 'Coverage gap':', '.join(sorted(cs(r))) or 'hours not listed',
                 'Lead with':'Review request + AI replies' if bk=='review' else 'Receptionist / voice agent',
                 'Subject':SUBJ[bk][h(r,len(SUBJ[bk]))],'Email body':body(r,bk)})
rows.sort(key=lambda x:-num(x['Reviews']))
with open('pool3_leads_tierB.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print("WROTE",len(rows))
print("providers:",dict(collections.Counter(x['Provider'] for x in rows)))
print("states:",collections.Counter(x['ST'] for x in rows).most_common(6))
