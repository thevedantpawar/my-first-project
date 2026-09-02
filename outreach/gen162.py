import csv, collections, hashlib, json
raw=list(csv.DictReader(open('leads_raw.csv',encoding='utf-8')))
def num(v,d=0.0):
    try: return float(v)
    except: return d
q={r['Email'].lower() for r in csv.DictReader(open('medspa_qualified_leads_enriched.csv',encoding='utf-8'))}
CH={'skinspirit.com','viomedspa.com','elase.com','tal-spa.com','newimageworks.com'}
CHNAME={'skinspirit.com':'SkinSpirit','viomedspa.com':'VIO Med Spa','elase.com':'Elase',
        'newimageworks.com':'New Image Works','tal-spa.com':'The Aesthetics Lounge & Spa'}
base=[r for r in raw if r['Tier']=='A' and r['Phone'] and num(r['Rating'])>=4.0
      and num(r['Reviews'])>=150 and r['Email'].lower() not in q]
c5=[r for r in base if r['Email'].split('@')[-1].lower() not in CH]
c4=[r for r in base if r['Email'].split('@')[-1].lower() in CH]

def cs(r): return set(x for x in (r.get('Closed days') or '').split(';') if x)
def h(r,n): return int(hashlib.md5((r['Business']+r['Email']).encode()).hexdigest(),16)%n

SUB={'weekend':['weekend calls','weekend coverage','weekend voicemail','saturday calls'],
     'sunday':['sunday calls','sunday coverage','sunday voicemail'],
     'multi':['two dark days','monday backlog','midweek gap'],
     'satonly':['saturday calls','saturday coverage'],
     'volume':['front desk','after hours','missed calls','call volume'],
     'review':['review replies','unanswered reviews'],
     'chain':['location routing','front desk routing']}

def bucket(r,chain=False):
    if chain: return 'chain'
    if num(r['Rating'])<4.6: return 'review'
    c=cs(r)
    if {'Saturday','Sunday'}<=c: return 'weekend'
    if 'Sunday' in c and len(c)>1: return 'multi'
    if c=={'Sunday'}: return 'sunday'
    if c=={'Saturday'}: return 'satonly'
    if c: return 'multi'
    return 'volume'

def opener(r,b):
    rv=int(num(r['Reviews'])); rt=r['Rating']; c=r['City']; v=h(r,4); cl=sorted(cs(r))
    big = rv>=800
    if b=='review':
        return [f"{rt} across {rv} reviews, and the critical ones look unanswered — that's what a new patient reads first.",
                f"You're at {rt} on {rv} reviews. That's usually a follow-up gap, not a treatment one.",
                f"{rv} reviews at {rt}. The distance between that and a 4.9 nearby is almost always unanswered criticism.",
                f"At {rv} reviews you have plenty of proof — the {rt} is being held down by the few nobody replied to."][v]
    if b=='weekend':
        return [f"{rv} reviews at {rt}, and both Saturday and Sunday show dark. That's two days a week of {c} calls going to voicemail.",
                f"Closed Saturday and Sunday against {rv} reviews — whoever calls this weekend books somewhere else by Monday.",
                f"Both weekend days closed. At {rv} reviews that's a meaningful number of {c} inquiries you never hear about.",
                f"{rv} reviews says demand is there. A dark weekend says a chunk of it never reaches you."][v]
    if b=='sunday':
        return [f"{rv} reviews at {rt}, and Sunday still shows dark on the calendar.",
                f"Sunday's closed, and {rv} reviews suggests people are still calling on Sunday.",
                f"At {rv} reviews you're not short on demand — Sunday callers just get voicemail.",
                f"One dark day a week doesn't sound like much until you multiply it against {rv} reviews' worth of demand."][v]
    if b=='satonly':
        return [f"Saturday's the one day you're closed — and Saturday is when most people actually have time to call about aesthetics.",
                f"{rv} reviews at {rt}, with Saturday dark. That's the highest-intent day of the week to be unreachable."][v%2]
    if b=='multi':
        d=', '.join(cl) if cl else 'those days'
        return [f"Closed {d}. Everything from those days lands at once on the next open morning, on the same team.",
                f"You're closed {d} — the calls don't stop, they just pile up for whoever opens next.",
                f"{rv} reviews at {rt}, closed {d}. Two dark days is a lot of inbound arriving together.",
                f"Closed {d}, which patients rarely remember. Unexpected closures generate more confused calls than weekend ones."][v]
    # volume — hours unknown, so never claim a closure
    return [f"{rv} reviews at {rt} means the phone rarely stops.",
            f"{rv} reviews is a lot of traffic through one front desk.",
            f"At {rv} reviews you're fielding more calls than any front desk books cleanly.",
            f"{rv} reviews at {rt}. At that volume the constraint stops being demand and becomes who picks up."][v]

def middle(r,b):
    v=h(r,3); rv=int(num(r['Reviews']))
    if b=='review':
        return ["Review requests fire on a real treatment-completed event rather than a blast, and replies come back drafted for a manager to approve. Public auto-posting stays off by default — replying to a review confirms that person was a patient, and that's a human's call.",
                "Requests trigger after treatment actually completes, and every reply is drafted for approval before it posts. Nothing goes public without a person signing off.",
                "The ask fires on treatment completion, and replies arrive drafted for review. Auto-posting ships disabled on purpose: a public reply confirms someone was a patient."][v]
    if rv>=800:
        return ["At that volume the phone is the bottleneck. An agent answers around the clock, quotes your real prices instead of deflecting, and books as pending so your front desk still confirms every slot. Clinical questions it won't touch — those route to a provider callback on a tracked two-hour clock.",
                "An agent handles the overflow: answers, quotes real pricing, books as pending so a human confirms. It refuses anything clinical outright, routing it to a provider callback within two hours. Paired with 24- and 2-hour reminders that can't double-send.",
                "An agent picks up what the desk can't, books as pending so nothing lands confirmed without a person, and hands every clinical question to a provider callback on a two-hour SLA."][v]
    return ["An agent covers the hours you can't. It quotes your real prices rather than deflecting to a callback, and books into your calendar as pending so your team still confirms. Anything clinical routes to a provider callback on a tracked two-hour clock.",
            "An agent answers those hours, quotes real pricing, and books as pending so a human confirms before anything is real. It won't touch a clinical question — those go to a provider callback within two hours.",
            "An agent takes those calls, quotes your actual prices, and books as pending so your team keeps the last word. Clinical questions never get an automated answer."][v]

def chain_body(r):
    d=r['Email'].split('@')[-1].lower(); nm=CHNAME[d]; rv=int(num(r['Reviews'])); loc=r['Business'].split('|')[-1].strip()
    return (f"Reaching out about the {loc} location specifically — {rv} reviews there, and inbound to {nm} lands wherever the caller happened to search.\n\n"
            f"A misrouted call is a booking the network paid for and lost. An agent that knows every {nm} location's real hours routes before it books, and books as pending so each front desk still confirms.\n\n"
            f"If someone at corporate owns this decision, happy to be pointed there instead.\n\nWorth a look?")

CTA=['Worth exploring?','Worth a look?','Useful?','Worth a short conversation?']
def build(r,chain=False):
    b=bucket(r,chain)
    body = chain_body(r) if chain else f"{opener(r,b)}\n\n{middle(r,b)}\n\n{CTA[h(r,4)]}"
    lead = ('Receptionist — multi-location routing' if chain else
            'Review request + AI replies' if b=='review' else
            'Receptionist + no-show prevention' if num(r['Reviews'])>=800 else
            'Receptionist / voice agent')
    return {'Business':r['Business'],'City':r['City'],'ST':r['ST'],'Email':r['Email'],'Phone':r['Phone'],
            'Website':r['Website'],'Rating':r['Rating'],'Reviews':r['Reviews'],
            'Coverage gap':', '.join(sorted(cs(r))) or 'HOURS NOT IN WORKBOOK - do not claim a closure',
            'Lead with':lead,'Subject':SUB[b][h(r,len(SUB[b]))],'Email body':body}

rows=[build(r) for r in sorted(c5,key=lambda x:-num(x['Reviews']))]
crows=[build(r,True) for r in sorted(c4,key=lambda x:-num(x['Reviews']))]
for fn,rr in [('pool4_ready162.csv',rows),('pool5_chain_locations.csv',crows)]:
    with open(fn,'w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(rr[0].keys())); w.writeheader(); w.writerows(rr)
    print(f"WROTE {fn}: {len(rr)}")
print("subjects:",dict(collections.Counter(x['Subject'] for x in rows)))
print("lead-with:",dict(collections.Counter(x['Lead with'] for x in rows)))
print("hours-unknown rows flagged:",len([x for x in rows if 'NOT IN WORKBOOK' in x['Coverage gap']]))
print("\nTOP LEAD:",rows[0]['Business'],"|",rows[0]['Subject']); print(rows[0]['Email body'])
