import csv, collections, hashlib
raw=list(csv.DictReader(open('leads_raw.csv',encoding='utf-8')))
def num(v,d=0.0):
    try: return float(v)
    except: return d
sent=set()
for f in ['medspa_qualified_leads_enriched.csv','pool2_leads_100plus.csv','pool3_leads_tierB.csv',
          'pool4_ready162.csv','pool5_chain_locations.csv']:
    for r in csv.DictReader(open(f,encoding='utf-8')): sent.add(r['Email'].lower())
print("already have emails:",len(sent))
rest=[r for r in raw if r['Email'].lower() not in sent]
print("remaining to write:",len(rest))

def cs(r): return set(x for x in (r.get('Closed days') or '').split(';') if x)
def h(r,n): return int(hashlib.md5((r['Business']+r['Email']).encode()).hexdigest(),16)%n

def cat(r):
    t=r['Tier']; rv=num(r['Reviews']); rt=num(r['Rating'])
    if t=='C': return 'C-unverified'
    if t=='B': return 'B-thin'
    if not r['Phone'] or rt<4.0: return 'A-excluded'
    if rv>=100: return 'A-dupe'
    if rv>=50: return 'A-50to99'
    return 'A-under50'
CAT_NOTE={
 'C-unverified':'VERIFY DOMAIN FIRST - workbook flags corporate domain does not match website; may bounce',
 'B-thin':'personal/free inbox (owner) - use a warmed sending domain, low review volume',
 'A-excluded':'no phone on file or rating under 4.0 - confirm the business is active before sending',
 'A-dupe':'shares a domain with a lead already contacted - do not double-send to the same company',
 'A-50to99':'smaller practice, 50-99 reviews',
 'A-under50':'very small or new - under 50 reviews; qualify on the call, not from the data'}

SUB={'weekend':['weekend calls','weekend coverage','weekend voicemail'],
     'sunday':['sunday calls','sunday coverage','sunday voicemail'],
     'multi':['two dark days','monday backlog','midweek gap'],
     'sat':['saturday calls','saturday coverage'],
     'small':['front desk','after hours','missed calls'],
     'review':['review replies','unanswered reviews']}
def bucket(r):
    if num(r['Rating'])<4.5 and num(r['Reviews'])>=25: return 'review'
    c=cs(r)
    if {'Saturday','Sunday'}<=c: return 'weekend'
    if 'Sunday' in c and len(c)>1: return 'multi'
    if c=={'Sunday'}: return 'sunday'
    if c=={'Saturday'}: return 'sat'
    if c: return 'multi'
    return 'small'

def body(r,b,c):
    rv=int(num(r['Reviews'])); rt=r['Rating']; city=r['City']; v=h(r,3); cl=sorted(cs(r))
    tiny = rv<50
    if b=='review':
        op=[f"{rt} across {rv} reviews — the critical ones look unanswered, and that's the first thing a new patient reads.",
            f"You're at {rt} on {rv} reviews. At your size a couple of unanswered complaints move the average a lot.",
            f"{rv} reviews at {rt}. The gap is usually follow-up, not treatment."][v]
        mid="Review requests fire after a treatment actually completes, and replies come back drafted for you to approve. Nothing posts publicly without a person — a public reply confirms someone was a patient."
    elif b=='weekend':
        op=[f"Both weekend days closed. Even at {rv} reviews, that's {city} calls going to voicemail every Saturday.",
            f"Closed Saturday and Sunday — whoever calls this weekend books with whoever picks up.",
            f"{rv} reviews at {rt}, and the weekend is dark."][v]
        mid=("An agent answers those hours, quotes your real prices, and books as pending so you confirm. "
             "It won't touch a clinical question — those route to a provider callback.")
    elif b=='sunday':
        op=[f"Sunday's closed, and people still call on Sunday.",
            f"{rv} reviews at {rt}, Sunday still dark on the calendar.",
            f"One dark day a week is easy to ignore until you count the calls."][v]
        mid="An agent covers Sunday, quotes real pricing, and books as pending so you confirm. Clinical questions go to a provider callback."
    elif b=='sat':
        op=f"Saturday's the one day you're closed — and Saturday is when most people have time to call about aesthetics."
        mid="An agent covers it, quotes real prices, and books as pending for you to confirm Monday."
    elif b=='multi':
        d=', '.join(cl) if cl else 'those days'
        op=[f"Closed {d}. Everything from those days arrives at once on the next open morning.",
            f"You're closed {d} — the calls don't stop, they just wait for you.",
            f"Closed {d}, which patients rarely remember. Unexpected closures generate the most confused calls."][v]
        mid="An agent works the queue as it lands instead of letting it stack, and books as pending so you confirm."
    else:
        if tiny:
            op=[f"Small practice, and every call that comes in while you're treating someone is a booking decided by whether you can pick up.",
                f"At your size the phone competes directly with the treatment room, and the treatment room has to win.",
                f"A growing practice loses more bookings to an unanswered phone than to price."][v]
        else:
            op=[f"{rv} reviews at {rt} means the phone rarely stops.",
                f"{rv} reviews is a lot of traffic through one front desk.",
                f"At {rv} reviews you're fielding more calls than one desk books cleanly."][v]
        mid="An agent answers what you can't, quotes your real prices, and books as pending so you confirm before anything is real."
    close=['Worth a look?','Worth exploring?','Useful?'][h(r,3)]
    if c=='C-unverified':
        return f"{op}\n\n{mid}\n\n{close}"
    return f"{op}\n\n{mid}\n\n{close}"

rows=[]
for r in rest:
    c=cat(r); b=bucket(r)
    rows.append({'Category':c,'Business':r['Business'],'City':r['City'],'ST':r['ST'],'Email':r['Email'],
                 'Tier':r['Tier'],'Phone':r['Phone'],'Website':r['Website'],'Rating':r['Rating'],'Reviews':r['Reviews'],
                 'Coverage gap':', '.join(sorted(cs(r))) or 'hours not in workbook',
                 'Lead with':'Review request + AI replies' if b=='review' else 'Receptionist / voice agent',
                 'Subject':SUB[b][h(r,len(SUB[b]))],'Email body':body(r,b,c),
                 'Before sending':CAT_NOTE[c]})
order={'A-dupe':0,'A-50to99':1,'A-under50':2,'A-excluded':3,'B-thin':4,'C-unverified':5}
rows.sort(key=lambda x:(order[x['Category']],-num(x['Reviews'])))
with open('pool6_remaining.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print("WROTE pool6_remaining.csv:",len(rows))
print(dict(collections.Counter(x['Category'] for x in rows)))
tot=len(sent)+len(rows)
print(f"\nTOTAL EMAILS NOW: {tot} of {len(raw)} leads")
