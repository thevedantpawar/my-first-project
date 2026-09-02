import csv, collections, hashlib
def num(v,d=0.0):
    try: return float(v)
    except: return d
def h(k,n): return int(hashlib.md5(k.encode()).hexdigest(),16)%n

# ---- assemble every lead with its touch-1 email ----
rows=[]
def add(src,pool,pri,extra=None):
    for r in csv.DictReader(open(src,encoding='utf-8')):
        rows.append({'Pool':pool,'Priority':pri,'Business':r['Business'],'City':r.get('City',''),'ST':r.get('ST',''),
            'Email':r['Email'],'Phone':r.get('Phone',''),'Website':r.get('Website',''),
            'Rating':r.get('Rating',''),'Reviews':r.get('Reviews',''),
            'Employees':r.get('Employees',''),'Segment':r.get('Segment',''),
            'Coverage gap':r.get('Coverage gap',''),'Lead with':r.get('Lead with',''),
            'Warnings':r.get('Enrichment note','') or r.get('Before sending','') or r.get('Data flags',''),
            'T1 subject':r['Subject'],'T1 body':r.get('Email body','')})

add('medspa_qualified_leads_enriched.csv','1 Qualified','P1 send first')
add('pool4_ready162.csv','4 Passed all gates','P2 send second')
add('pool2_leads_100plus.csv','2 100-149 reviews','P3')
add('pool3_leads_tierB.csv','3 Tier B owners','P4 warm domain first')
add('pool5_chain_locations.csv','5 Chain locations','P4 route to corporate')
add('pool6_remaining.csv','6 Long tail','P5 last')

# Pool 1 bodies live in the markdown files, not the CSV — mark them
for r in rows:
    if r['Pool'].startswith('1') and not r['T1 body']:
        r['T1 body']='[hand-written — see p1_emails.md / p2_emails.md / core_small_emails.md / pool1_emails.md]'
print("leads assembled:",len(rows))

# ---- follow-up generator: angle rotates, never repeats touch 1 ----
def led(r):
    l=r['Lead with'] or ''
    if 'Review' in l: return 'review'
    if 'routing' in l: return 'chain'
    if 'no-show' in l: return 'volume'
    return 'coverage'

def fu1(r):   # day 3 — NEW value piece, different automation from touch 1
    v=h(r['Email']+'a',3); k=led(r)
    if k=='review':
        return ("no-show math", ["One more thing worth a number: reminders at 24 and 2 hours are the cheapest revenue in a clinic, and they're idempotent — a job that runs twice still only texts once. No double-texting, no annoyed patients.",
            "Separate from reviews: 24- and 2-hour reminders that can't double-send. Most no-show software texts twice when the cron misfires. This one can't.",
            "Adjacent piece: automated reminders that survive a re-run without double-texting anyone. Small detail, but it's the one that makes patients trust the messages."][v])
    if k=='chain':
        return ("per-location numbers", ["Worth adding: everything reports per location, so you can see which sites are actually dragging the average instead of guessing from a network-wide number.",
            "One more: the reporting is per location. Network averages hide the two sites causing the problem.",
            "Adding to the last note — per-location reporting, so a network number never hides a single-site issue."][v])
    return ("dormant patients", ["Beyond the phone: a daily job flags anyone with no visit in 45-plus days and nothing booked, texts a rebooking link, then a credit offer three days on. Thirty-day cooldown so nobody gets pestered.",
        "Separate from coverage — patient bases go quiet silently. A daily job catches anyone dormant past 45 days with nothing on the books and works them over two touches.",
        "One more piece: dormant-patient reactivation. Past 45 days with nothing booked, they get a rebooking link, then a credit offer, then left alone for 30 days."][v])

def fu2(r):   # day 7 — verifiable product mechanics. NOT a fabricated case study.
    v=h(r['Email']+'b',3)
    return ("how it books", ["Worth being concrete about one design choice: it books appointments as pending, never confirmed. An agent that mishears \"the fourteenth\" as \"the fortieth\" should not put a confirmed appointment on your calendar — your front desk stays the last word.",
        "One mechanic that matters: bookings land as pending, not confirmed. Your team approves every slot before it's real. That's deliberate — voice agents mishear dates, and a wrong confirmed booking costs more than a missed call.",
        "The part most vendors skip: it refuses clinical questions outright. Medications, contraindications, reactions — none get an automated answer. They route to a provider callback on a two-hour clock the system then tracks."][v])

def fu3(r):   # day 14 — new angle matched to their data
    v=h(r['Email']+'c',2); rv=int(num(r['Reviews']))
    if rv>=500:
        return ("volume", ["At your review volume the constraint stopped being demand a while ago. It's throughput at the front desk — which is a systems problem, not a hiring one.",
            "One observation from your numbers: you're past the point where more marketing helps. Everything now is capture and retention."][v])
    return ("the quiet leak", ["The leak most clinics never measure: patients who meant to come back and didn't. Nobody cancels — they just stop. It doesn't show up in any report until the year-over-year number moves.",
        "Worth measuring if you haven't: how many patients from twelve months ago haven't returned. It's usually a larger number than anyone expects, and it's recoverable."][v])

def fu4(r):   # day 21 — breakup, 1-2-3 format
    return ("closing the loop", "Since I haven't heard back, I'll keep it simple. Reply with a number:\n\n1 — Interested, let's talk\n2 — Not now, check back in 3 months\n3 — Not interested, please stop\n\nOtherwise I'll leave you to it. Good luck with the practice.")

for r in rows:
    for i,f in enumerate([fu1,fu2,fu3,fu4],start=2):
        s,b=f(r)
        r[f'T{i} subject']=s
        r[f'T{i} body']=b
    r['Cadence']='T1 day 0 · T2 day 3 · T3 day 7 · T4 day 14 · T5 day 21'

order={'P1 send first':0,'P2 send second':1,'P3':2,'P4 warm domain first':3,'P4 route to corporate':4,'P5 last':5}
rows.sort(key=lambda x:(order[x['Priority']],-num(x['Reviews'])))
cols=['Rank','Pool','Priority','Cadence','Business','City','ST','Email','Phone','Website','Rating','Reviews',
      'Employees','Segment','Coverage gap','Lead with','Warnings',
      'T1 subject','T1 body','T2 subject','T2 body','T3 subject','T3 body','T4 subject','T4 body','T5 subject','T5 body']
with open('MASTER_send_list.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=cols,extrasaction='ignore'); w.writeheader()
    for i,r in enumerate(rows,1): r['Rank']=i; w.writerow(r)
print("WROTE MASTER_send_list.csv:",len(rows),"leads x 5 touches =",len(rows)*5,"emails")
print(dict(collections.Counter(r['Priority'] for r in rows)))
