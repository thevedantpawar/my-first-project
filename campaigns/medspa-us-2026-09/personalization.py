# -*- coding: utf-8 -*-
"""
Hand-written personalization, one entry per lead, keyed by Campaign Rank.

Per COLD_EMAIL_DIRECTIVES D16/D17: the email skeleton in templates/ is
human-authored and fixed. Only the two blocks below vary per lead.

  hook   -> Step 1 (Personalization). 1-2 sentences. Pure observation drawn
            from that clinic's own data. Must NOT signal that anything is
            being sold. Never longer than 2 sentences (D7: over-personalization
            reads as fake, not more real).
  angle  -> Step 3 (Offer, first half). 1-2 sentences naming the specific thing
            that would be fixed for THIS clinic, before the fixed offer lands.

  casual -> D16 casualization: how an insider would say the business name.
  hold   -> non-empty means DO NOT SEND until the note is resolved.
"""

LEADS = {
1: dict(
    multi=True,
    casual="Elase",
    subject="location routing",
    hook="Thirty-eight locations across seven states, and Sugar House still shows Sunday dark — plus that fifth-Saturday rule most callers won't know about. At 1,556 reviews on this one site, getting found clearly isn't the problem.",
    angle="At your footprint every inbound call is a routing decision before it's a booking. I wouldn't touch the network — just one site, whose real hours it actually knows, fifth Saturday included, booking as pending so that front desk keeps its own calendar.",
),
2: dict(
    multi=True,
    casual="Refresh",
    subject="weekend coverage",
    hook="Closed Saturday and Sunday across Jupiter, Port St. Lucie and Vero Beach. GLP-1 inquiries don't keep those hours — and you're LegitScript certified, so you'd actually read the architecture rather than take my word for it.",
    angle="Most booking tools drop patient names and numbers into a workflow tool's execution logs. Mine de-identifies before anything reaches a model, and it screens weekend inquiries — contraindication gates included — before it books them.",
),
3: dict(
    casual="Couture",
    subject="clinical questions",
    hook="A dermatology and plastic surgery practice probably shouldn't put a machine on the phone. Speculating about a lesion or a post-op reaction isn't worth any amount of booking convenience.",
    angle="So this one is built to refuse. Scheduling, pricing and FAQs only — the moment a caller mentions a medication, a contraindication or a reaction it stops and routes to a provider callback on a tracked two-hour clock. Bookings land as pending, so mishearing “the fourteenth” never puts a surgical consult on Dr. Spann's calendar.",
),
4: dict(
    casual="Suddenly Slimmer",
    subject="dormant list",
    hook="Operating since 1988 out of 12,000 square feet — which likely makes yours the largest dormant patient list of any med spa in Phoenix, just sitting there. Sunday's still dark on top of it.",
    angle="Two pieces. Sunday gets answered and books as pending so your desk confirms. And a daily job finds anyone with no visit in 45-plus days and nothing booked, texts a rebooking link, then a credit offer three days later, then leaves them alone for thirty.",
),
5: dict(
    casual="The Palm",
    subject="weekend calls",
    hook="A 5.0 across 1,062 reviews with two people on staff, and both weekend days dark. In Orlando that's two days a week of calls going to voicemail and booking somewhere else by Monday.",
    angle="Something that covers those hours, quotes your real prices, and books as pending so you still confirm. One thing upfront: you're on Vagaro, and I integrate with Acuity and Square, not Vagaro yet. Better said now than on a call.",
),
6: dict(
    casual="Kumi",
    subject="your bbb page",
    hook="Your BBB profile sits at C+ — not for the complaint, for not answering it. One unanswered item outweighing a thousand reviews at 4.6 is a system problem, not a staffing one.",
    angle="Review requests fire on treatment completion and replies come back drafted for your manager to approve before anything posts. Your free test spot is the other one — free consults no-show harder than anything in aesthetics, and Sunday callers currently get voicemail.",
),
7: dict(
    casual="Nob Hill",
    subject="membership churn",
    hook="Fixed monthly payments make Nob Hill a subscription business, and your reviews already say you're booked out. Which is the problem — on a full calendar a no-show isn't a gap in the day, it's revenue a waitlisted member would have paid for.",
    angle="Reminders at 24 and 2 hours that can't double-send even if the job runs twice, no-show recovery with a rebooking link then a credit, dormant flags at 45 days. Consent-aware, STOP handled.",
),
8: dict(
    casual="Aventura Derm",
    subject="three people",
    hook="893 reviews at 4.9 against a three-person practice. Dr. Baum's team is carrying a patient load that would staff a clinic four times the size, and both weekend days are dark.",
    angle="At three people the answer isn't more software, it's the one piece that removes the most interruption: the phone gets answered, books as pending, and refuses every clinical question outright — those route to a provider callback on a two-hour clock. Just that. Not a platform.",
),
9: dict(
    casual="Modern SLC",
    subject="weekend calls",
    hook="867 reviews at a flat 5.0, three people, weekends closed. The rating says everyone who gets through books — the staffing says most people don't get through.",
    angle="One thing, not a suite: the hours you can't cover get covered, your real prices quoted, everything booked as pending so you still confirm.",
),
10: dict(
    casual="Golden Glow",
    subject="seven people",
    hook="863 reviews against a seven-person team is the widest demand-to-staff gap on my list. Fifteen years in Tampa Bay will do that — and Sunday is still dark.",
    angle="Two pieces, not five. Sunday gets answered and books as pending so you confirm. And reminders at 24 and 2 hours cut no-shows without anyone making calls — at seven staff, an hour of chasing is an hour not treating.",
),
11: dict(
    casual="New Image",
    subject="sunday calls",
    hook="811 reviews at 4.9 and Sunday still shows dark. At that review volume you have a large patient base — and patient bases go quiet silently.",
    angle="Sunday gets answered and books as pending. Underneath it, a job finds anyone with no visit in 45-plus days and nothing booked, texts a rebooking link, then a credit offer three days on, with a cooldown so nobody gets pestered into unsubscribing.",
),
12: dict(
    casual="Luminescence",
    subject="weekend coverage",
    hook="788 reviews at a flat 5.0 with eight people. That ratio says your team is excellent and badly outnumbered by your own demand — and both weekend days are dark.",
    angle="Weekends get answered, real prices quoted, everything booked as pending so a human still confirms. Paired with reminders at 24 and 2 hours that can't double-send. At eight staff that's cheaper than a tenth hire and available immediately.",
),
13: dict(
    casual="Revive",
    subject="solo practice",
    hook="711 reviews at 4.9 as essentially a one-person practice. Dr. Gombar can't inject and answer the phone at the same time, and closed Sunday and Monday means two days of calls with nobody to take them.",
    angle="For a solo practice the highest-value piece is the phone, not an automation stack. It answers, books as pending, and won't touch a clinical question. I'd rather sell you one thing that fits.",
),
14: dict(
    multi=True,
    casual="Youthful",
    subject="dormant patients",
    hook="Nineteen years in Jacksonville across two locations. The list of people who came once and drifted is several times your active count — and Thermage and CoolSculpting patients are exactly the ones who mean to come back and don't.",
    angle="A daily job finds anyone with no visit in 45-plus days and nothing on the books, texts a rebooking link, then a credit offer three days later, then leaves them alone for thirty. At 683 reviews you don't have a reputation problem — you have a re-booking one.",
),
15: dict(
    casual="ElaMar",
    subject="weekend calls",
    hook="A clean 5.0 across 659 reviews with both weekend days closed. That rating means the people who reach you convert — the problem is purely who doesn't.",
    angle="Weekends get answered, your real pricing quoted rather than deflected, everything booked as pending so your team confirms. One note: I have a Nashville address against an Alabama record, so correct me if I've got the wrong location.",
),
16: dict(
    casual="Capizzi MD",
    subject="weekend voicemail",
    hook="Closed both weekend days at 649 reviews. For a practice running surgical consults alongside med spa work, the Charlotte inquiries you never hear about are the expensive ones.",
    angle="Scheduling, pricing and FAQs only — medications, contraindications and reactions all route to a provider callback on a tracked two-hour clock. Bookings land as pending, never confirmed, so your front desk stays the last word on Dr. Capizzi's calendar.",
),
17: dict(
    casual="PRICK'D",
    subject="weekend voicemail",
    hook="622 reviews in about two years is a fast start, and a Botox bar lives on walk-in-speed convenience. Weekends closed cuts against exactly that promise.",
    angle="Those hours get answered and booked as pending. For a three-person shop it's the cheapest way to act open without being open.",
),
18: dict(
    casual="The Beauty Clinic",
    subject="after hours",
    hook="598 reviews at 5.0 with two people on staff. Every call that arrives while you're treating someone is a booking decided by whether you can pick up.",
    angle="So something else picks up — answers, quotes real prices, books as pending for you to confirm. That's the whole pitch; the rest of what I build would be overkill at your size.",
),
19: dict(
    casual="Essence",
    subject="monday backlog",
    hook="Closed Sunday and Monday both. Everything that arrives across those two days lands on the same Tuesday morning, on the same eight people.",
    angle="The queue gets handled as it arrives instead of stacking — answered, real prices quoted, booked as pending so Tuesday starts with a calendar rather than a full voicemail box.",
),
20: dict(
    casual="Dermave",
    subject="saturday calls",
    hook="573 reviews at 4.8, and Saturday is the one day you're closed — which on the Gulf Coast is the day most people actually have time to book aesthetics.",
    angle="Saturday gets answered and booked as pending for Monday confirmation. And a job flags anyone dormant past 45 days with nothing booked, texts a rebooking link, then a credit offer three days on.",
),
21: dict(
    multi=True,
    casual="Skin Pharm",
    subject="one clinic, not four",
    hook="Clinics in Nashville, Atlanta, Dallas and Houston, all closed both weekend days. At your size that isn't a missed-call problem — it's a repeatable per-clinic revenue number nobody is measuring.",
    angle="I wouldn't propose rolling anything across the network — weekends at one clinic, nothing else. Every patient identifier stays encrypted and gets de-identified before it reaches a model, which is the part your compliance reviewer asks about first.",
),
22: dict(
    casual="Lecada",
    subject="weekend calls",
    hook="480 reviews at 4.7 with Saturday and Sunday both dark. Tampa clients book aesthetics on weekends — that's when they have time to call.",
    angle="Those hours get answered, your real pricing quoted rather than deflected to “call us”, everything booked as pending before it's real. Clinical questions it won't touch — those route to a provider callback on a tracked two-hour clock.",
),
23: dict(
    casual="Prestige",
    subject="three people",
    hook="477 reviews at 4.9 against a three-person clinic. Dr. Sharabi's team carries a patient load that would staff something four times the size, and weekends are closed.",
    angle="At that headcount the phone is the single highest-value piece — answered, booked as pending, clinical questions refused outright. Hormone and anti-aging inquiries get screened before they hit the calendar. Just that.",
),
24: dict(
    multi=True,
    casual="RESTOR",
    subject="three to twenty",
    hook="You've said publicly you're going from three Colorado locations to twenty. The thing that breaks first in that jump is never treatment quality — it's the front desk, because call volume scales with locations and the people answering don't.",
    angle="Worth fixing before you scale rather than after: each location's real hours known, routed to the right calendar, booked as pending so every site still confirms. Functional medicine adds a wrinkle — hormone and weight-loss inquiries need screening, which sits outside the scoring as hard contraindication gates.",
),
25: dict(
    casual="Couture",
    subject="membership churn",
    hook="You sell memberships, which makes retention the number that actually moves — and a 4.6 across 440 reviews sits a little under where a 39-person practice probably wants to be.",
    angle="Two systems, not five. Dormant members flagged at 45 days with nothing booked, worked over two touches with a cooldown so nobody unsubscribes. And review requests firing on a real treatment-completed event, with replies drafted for a manager to approve before anything posts.",
),
26: dict(
    casual="Ecobel",
    subject="monday backlog",
    hook="Closed Sunday and Monday both, six staff in Buckhead. Two days of inbound arrives at once on Tuesday, on a team already treating patients.",
    angle="The queue gets worked as it lands instead of stacking — booked as pending so Tuesday starts with a calendar, not a voicemail box.",
),
27: dict(
    multi=True,
    casual="dermani Buckhead",
    subject="membership retention",
    hook="A membership model across a franchise network means churn compounds quietly — one location's retention problem doesn't surface until the cohort is already gone.",
    angle="Dormant members flagged at 45 days with nothing booked, worked over two touches with a cooldown, reported per location. For a chain that's a unit-economics change rather than a tool. Sunday's dark network-wide too, which is the cheaper of the two fixes.",
),
28: dict(
    casual="Winter Park Laser",
    subject="courses that stall",
    hook="Closed Saturday and Sunday against 422 reviews — whoever calls this weekend books somewhere else by Monday.",
    angle="Beyond coverage: laser and anti-aging work sells in courses, and courses stall. A sequence catches anyone dormant past 45 days with nothing booked, texts a rebooking link, then a credit offer three days on. Both run off the same patient record, so they never contradict each other.",
),
29: dict(
    casual="Glow",
    subject="monday backlog",
    hook="Closed Sunday and Monday with five staff. Two days of inbound arriving at once on Tuesday, against a team already treating patients.",
    angle="The queue gets worked as it lands rather than piling up, and books as pending so you confirm what's real.",
),
30: dict(
    casual="Basis",
    subject="weekend calls",
    hook="A clean 5.0 across 399 reviews with six people. Everyone who reaches you books — the constraint is who reaches you, and both weekend days are dark.",
    angle="One thing, not a platform: weekends answered, your real prices quoted, everything booked as pending so you still confirm.",
),
31: dict(
    casual="Be You",
    subject="wednesday",
    hook="Closed Sunday and Wednesday — an unusual split, and a hard one for patients to remember. Mid-week closures generate more confused calls and more no-shows than weekend ones, because nobody expects them.",
    angle="Your actual schedule gets answered on both days and books as pending. Reminders at 24 and 2 hours catch the people who booked and forgot Wednesday exists.",
),
32: dict(
    multi=True,
    casual="Michigan Advanced",
    subject="monday backlog",
    hook="Two locations, four staff, closed Sunday and Monday. Everything from those two days lands together on Tuesday morning.",
    angle="Both locations' hours known, calls answered as they arrive, booked as pending so your team confirms. At four people that's cheaper than a fifth hire and available now.",
),
33: dict(
    multi=True,
    casual="Amerejuve",
    subject="seven locations",
    hook="Seven locations across Texas and Georgia, all closed Sunday and Monday. A caller who reaches the wrong location is a booking the network already paid for and lost.",
    angle="Each location's real hours known, so it routes before it books, and books as pending so each front desk still confirms. Free consultations — which you offer — also no-show hardest; reminders at 24 and 2 hours cut that without anyone chasing.",
),
34: dict(
    casual="NSI",
    subject="weekend coverage",
    hook="363 reviews at 4.9 with both weekend days dark. In a market as competitive as Nashville, the weekend caller books with whoever answers.",
    angle="Those hours get covered, real pricing quoted, everything booked as pending so your team still confirms. Nothing clinical gets an automated answer.",
    hold="Email domain is tolmanmedical.com but the listing is NSI Wellness. Confirm this is the current contact before sending.",
),
35: dict(
    casual="Prime MD",
    subject="seven staff",
    hook="A flat 5.0 across 351 reviews says the people who reach you leave happy. With seven staff and both weekend days closed, the constraint is reach, not quality.",
    angle="One thing first: those hours covered, real prices quoted, booked as pending so you confirm. Your hormone and weight-loss lines need screening rather than straight booking — contraindication gates handle that before anyone reaches the calendar.",
),
36: dict(
    multi=True,
    casual="VIO",
    subject="franchise call routing",
    hook="A franchise network means inbound hits whichever location the caller happened to find, and a misrouted call is a booking the system already paid for and lost.",
    angle="Every location's real hours known, booked into the right calendar — routing fixed before coverage. For a franchisor that's a system-wide unit-economics change, not a single-clinic tool.",
    hold="Address is queencreek@ against an Aventura listing — almost certainly the wrong franchise contact. Find the corporate ops owner first.",
),
37: dict(
    casual="VIIV",
    subject="a third of the week",
    hook="A flat 5.0 across 325 reviews says the experience lands. Closed Sunday and Monday says a third of the week nobody's answering.",
    angle="Both days covered, your real prices quoted, booked as pending so your team confirms. In Miami, where the aesthetics market is as dense as it gets, answering first is most of winning.",
),
38: dict(
    casual="Serenity",
    subject="review replies",
    hook="4.5 across 316 reviews puts you under most SF med spas on the same block, and the critical ones look unanswered. In a market where clients compare four clinics before booking, that half-star does real damage.",
    angle="Requests fire on an actual treatment-completed event rather than a blast, and replies come back drafted for a manager to approve. Public auto-posting stays off by default — replying to a review confirms the person was a patient, and that's a human's call.",
),
39: dict(
    casual="Gateway",
    subject="review replies",
    hook="4.4 across 310 reviews is a good practice with a visible gap — the critical ones look unanswered, and that's what a prospect reads first.",
    angle="Requests fire on a real treatment-completed event rather than a blast, with replies drafted for a manager to approve before anything posts. You're also closed both weekend days, which is the other half of the same problem.",
),
40: dict(
    multi=True,
    casual="Med 1",
    subject="two locations",
    hook="Ann Arbor and Wyandotte, two people, a flat 5.0 across 306 reviews. Dr. O'Neill can't inject in one city and answer the phone in the other.",
    angle="Both locations' hours known, calls answered, everything booked as pending. That's the whole pitch — the rest of what I build would be overkill at your size.",
),
41: dict(
    casual="Natural Beauty",
    subject="solo practice",
    hook="301 reviews at 4.9 as essentially a one-person operation. Every call that arrives while you're treating someone is a booking decided by whether you can pick up — and you can't.",
    angle="So something else picks up. Answers, quotes real prices, books as pending for you to confirm when you're free. One thing that fits, not five that don't.",
),
42: dict(
    multi=True,
    casual="Allure",
    subject="fourteen locations",
    hook="Fourteen locations across three states, and a 4.5 that sits below where a network your size probably wants it. At that footprint the rating isn't a service problem — review follow-up just doesn't scale by hand past about three sites.",
    angle="Requests fire on a real treatment-completed event, replies come back drafted for approval, and everything reports per location so you can see which sites are actually dragging the average. I'd start with your three worst.",
),
43: dict(
    casual="Shino Bay",
    subject="clinical questions",
    hook="A practice running cosmetic dermatology alongside plastic surgery shouldn't put a machine on the phone unsupervised — speculating about a post-op reaction isn't worth any amount of booking convenience.",
    angle="So this one is built to refuse. Scheduling, pricing and FAQs only; a medication, a contraindication or a reaction stops it dead and routes to a provider callback on a tracked two-hour clock. Bookings land as pending, so your team keeps the last word. Relevant because both weekend days are currently dark.",
),
44: dict(
    multi=True,
    casual="Juvly",
    subject="eleven locations",
    hook="Eleven locations across five states, all closed both weekend days, and a 4.6 sitting below where a network your size probably wants to be.",
    angle="Two things scale badly by hand at that footprint: weekend call coverage, and review follow-up after treatment. Both run as systems rather than headcount, and both report per location so you can see which ones are actually the problem. I'd start with a single state.",
),
45: dict(
    casual="Enigma",
    subject="weight loss inquiries",
    hook="Medical weight loss is your lead offer, and weight-loss inquiries arrive in volume, mostly unqualified, mostly outside business hours. With two people, sorting them by hand is the job nobody has time for.",
    angle="Six questions over chat or SMS score and route them, with contraindication gates sitting outside the scoring — pregnancy disqualifies to a medical callback regardless of every other answer. The ones worth your time reach the calendar. The rest don't.",
),
46: dict(
    casual="Tre",
    subject="solo practice",
    hook="265 reviews at 4.8 running solo in Westchase. Every hour treating is an hour not answering, and both weekend days are dark on top of that.",
    angle="It answers, quotes real prices, books as pending. One piece, sized for a one-person practice.",
),
47: dict(
    casual="St. Louis Skin",
    subject="twenty-one years",
    hook="Twenty-one years in St. Louis with both weekend days closed. A practice that established doesn't have an awareness problem — it has an availability one.",
    angle="Weekends answered, real prices quoted, booked as pending so Dr. Miller's team still confirms. Your laser and injectable work also sells in series, and series stall — a job catches anyone dormant past 45 days with nothing booked.",
),
48: dict(
    casual="CMA",
    subject="weekend coverage",
    hook="Closed Saturday and Sunday with sixteen staff and 250 reviews at 4.8. For a research-forward practice like Dr. Schallen's, the weekend caller is usually the one doing the most homework — and comparing you against whoever picks up.",
    angle="Those hours get answered, your real pricing quoted rather than deflected to a callback, and everything booked as pending so your team confirms. Anything clinical it won't touch.",
),
49: dict(
    multi=True,
    casual="Charlotte Plastic",
    subject="weekend consults",
    hook="A practice running since 1951 across two Charlotte locations, closed both weekend days. Surgical consults are the most expensive appointment you book — and the weekend caller who reaches voicemail is the one comparison-shopping three surgeons.",
    angle="Those hours get covered and book as pending, never confirmed, so your team keeps the last word on the surgical calendar. And it refuses clinical questions outright — a procedure, a recovery, a medication all route to a provider callback on a tracked two-hour clock.",
),
50: dict(
    multi=True,
    casual="Manhattan Derm",
    subject="front desk triage",
    hook="Three locations running general dermatology alongside cosmetic means one phone line triages a skin-cancer screening and a filler consult with the same greeting — and both weekend days are dark.",
    angle="Cosmetic inquiries get qualified before they reach your desk. Anything clinical never gets an automated answer at all — it routes to a provider callback on a tracked two-hour clock. For an integrative practice like Dr. Magovern's, the routing matters more than the answering.",
),
}

# Follow-up subject lines. Varied per D10 so subject performance can be tested
# independently of body. Rotated by rank so no mailbox sends the same four
# subjects to every prospect in a batch.
FOLLOWUP_SUBJECTS = {
    "T2": ["quick one", "one number", "checking this landed", "following up once"],
    "T3": ["how it books", "the mechanics", "how it actually works", "what it does"],
    "T4": ["where these fail", "the rollout question", "the honest version", "what breaks first"],
    "T5": ["closing the loop", "last one", "1, 2 or 3", "wrapping this up"],
}
