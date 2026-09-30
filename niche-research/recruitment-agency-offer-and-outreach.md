# AI Automation for Recruitment Agencies: Service Breakdown and Cold Outreach Playbook

Target market: US recruitment and staffing agencies with 3–50 recruiters (contingency or retained).
Positioning: **"I build AI candidate sourcing and outreach systems for recruitment agencies."**

Placeholders in `{{double_braces}}` are filled per prospect. Text in `[square brackets]` is yours to replace.

---

## Part 1: What we sell to recruitment agencies

### 1.1 The problem, in their words

A recruitment agency only makes money when it **makes a placement**. A typical US placement fee is 15–25% of the candidate's first-year salary, so one placement on a $90k role is worth about $13k–$22k to the agency.

Most recruiters spend their day on work that does not directly close placements:

| Where a recruiter's time goes | What it costs the agency |
|---|---|
| Writing boolean searches, scrolling LinkedIn and job boards | Hours per role, repeated for every new job |
| Writing InMails and emails one by one, most of which get no reply | Low reply rates, so they need to contact hundreds of people |
| Chasing replies, scheduling screening calls, sending reminders | Slow response, so a faster agency wins the candidate |
| Typing call notes and updating the ATS | Bad data in the ATS, so old candidates never get reused |
| Reformatting CVs and writing candidate summaries for clients | Slower submissions to the client |
| Doing business development (finding new clients and job orders) between all of the above | Inconsistent pipeline of new jobs |

Meanwhile, their **ATS already holds thousands of candidates** they paid to find, and almost none of them get contacted again.

**What we promise:** more qualified candidates in front of recruiters, faster, with less manual work, so each recruiter can handle more roles and make more placements.

### 1.2 The service: "AI Recruiting Engine" (4 modules)

You can sell the modules separately, but they work best together. **Lead with Module 1** because it is the easiest to demo and prove. Add the other modules once the client trusts you.

---

#### Module 1: AI Candidate Sourcing and Outreach Agent (core offer)

**What it does, step by step:**

1. **Job intake.** The recruiter drops a job spec into a form, a Slack message or the ATS. The AI turns it into a clear candidate profile: must-have skills, nice-to-haves, target job titles, target companies to poach from, location or remote rules and salary band.
2. **Database rediscovery first.** The agent searches the agency's **own ATS** for past applicants and candidates who match. This is often the quickest win, because those people already know the agency.
3. **External sourcing.** It then builds a list from outside sources the agency already has access to, such as LinkedIn Recruiter or Sales Navigator exports, job-board CV databases (Indeed, Dice, Monster and so on) and GitHub for tech roles. It adds contact details with an enrichment tool (for example Apollo, Clay or ContactOut).
4. **AI scoring.** Every candidate gets a 1–10 match score with a one-line reason, for example "7 yrs PLC programming, currently at a competitor, 20 miles from site". Recruiters review the top of the list instead of scrolling hundreds of profiles.
5. **Personalized outreach.** The agent writes a short, personal first message for each candidate that references their actual experience. It then sends a 3–4 step sequence by email, plus LinkedIn where allowed. Messages go out from the recruiter's own name and a properly warmed-up inbox.
6. **Reply handling.** The AI sorts replies into interested, not now, wrong fit, referral and unsubscribe. It answers basic questions (remote? salary range? who's the client?) using approved answers only. Interested candidates get a booking link straight into the recruiter's calendar.
7. **ATS sync.** Every candidate, message, reply and booked call is logged in the ATS (Bullhorn, Loxo, Recruit CRM, JobAdder, Crelate, Vincere and so on), so nothing lives in a side spreadsheet.

**What the recruiter sees:** each morning, a shortlist of scored candidates plus screening calls already booked on their calendar.

---

#### Module 2: AI Screening and Submission Assistant

- **Call notes to ATS:** screening calls are recorded (with consent) and transcribed. The AI writes a structured summary covering skills, motivation, notice period, salary expectations and red flags, and saves it in the ATS.
- **Client-ready candidate write-ups:** the AI drafts the submission email or profile in the agency's own template. It can also reformat or anonymize the CV (removing contact details so the client can't go around the agency).
- **Interview scheduling and reminders:** it coordinates times between the candidate and the client, sends reminders and prep notes, and chases feedback after interviews.
- **Candidate nurture:** it keeps "not now" candidates warm with periodic check-ins, so they come back when they're ready to move.
- *Optional:* an AI voice pre-screen for high-volume roles (light industrial, healthcare, call centers). It asks 5–8 knockout questions and passes qualified candidates to a human.

---

#### Module 3: AI Business Development Agent (more job orders)

This module wins the agency more clients.

- **Hiring-signal monitoring:** every week the agent finds companies in the agency's specialty and region that are hiring for the roles the agency places. Roles still open after 21–30 days are the best targets, because the company is struggling to fill them.
- **Finding the decision-maker:** it identifies the hiring manager or head of department and their verified email.
- **Personalized BD outreach:** it drafts a short note referencing the company's open role, and optionally a relevant anonymized candidate the agency already has (an "MPC", or most placeable candidate, email). The note goes out from the agency owner's or recruiter's name.
- **Meeting booking:** positive replies are routed to the owner's calendar and logged in the CRM.

---

#### Module 4: Monthly Optimization and Reporting (the retainer)

- **Weekly dashboard:** roles worked, candidates sourced, reply rate, screens booked, submissions, interviews and placements.
- **Ongoing tuning:** we test new message versions, adjust the scoring rules and refresh sources.
- **Database reactivation campaigns:** we periodically contact old candidates and dormant clients.
- **Maintenance:** we fix broken integrations, manage inbox health and deliverability, and handle API costs.
- **Monthly strategy call:** we review what's working and roll out the next automation.

---

### 1.3 Before and after: one role, one recruiter

| | Before | After |
|---|---|---|
| Day 1 | Recruiter spends 3 hrs building searches and messaging 40 people | Recruiter pastes the job spec; the agent pulls 150 matched profiles overnight, including 30 from their own ATS |
| Day 2 | 3 replies; recruiter chases them by email | Top 60 get personal messages from the recruiter's inbox; replies are handled automatically |
| Day 3–5 | 1–2 screens booked; notes typed by hand | 6–10 screening calls booked on their calendar; notes and summaries go into the ATS automatically |
| Submission | Recruiter writes each profile manually | AI drafts the submission in the agency's template; recruiter edits and sends |

*The figures above are illustrative targets. Replace them with real numbers from your pilots.*

### 1.4 Typical tech stack (you choose; the client never needs to touch it)

- **Workflow automation:** n8n or Make
- **AI:** Claude or GPT API for parsing, scoring, writing messages and summarizing
- **Sourcing and enrichment:** the agency's LinkedIn Recruiter or Sales Navigator seat, Apollo, Clay, job-board CV databases
- **Email sending:** Instantly or Smartlead on separate warmed-up domains, so the agency's main domain is never at risk
- **Scheduling:** Calendly or Cal.com
- **Voice (optional):** Retell or Vapi
- **ATS:** via its API or Zapier and webhooks (Bullhorn, Loxo, Recruit CRM, JobAdder, Crelate and similar)

### 1.5 Compliance guardrails (say this on sales calls, because it builds trust)

- **A human makes every hiring decision.** AI only ranks and drafts. Recruiters review before anything goes to a client.
- **No protected characteristics.** Scoring is based only on job-relevant criteria (skills, experience, location, eligibility), never age, gender, race and so on. This matters under EEOC rules.
- **AI hiring laws.** Some jurisdictions regulate automated hiring tools. NYC Local Law 144, for example, requires a bias audit and notices, and Illinois and Colorado have AI-in-employment rules. Keep a human in the loop, and have the client confirm with their counsel for their states.
- **Email and SMS.** Follow CAN-SPAM (real sender, physical address, working opt-out). **Don't send cold SMS** to candidates without consent, because of TCPA risk. Use SMS only for people who have opted in.
- **LinkedIn.** Use the agency's own seats within LinkedIn's limits. Don't scrape aggressively or use tools that risk getting accounts banned.
- **Data.** Store candidate data in the client's systems, sign an NDA or DPA if asked, and give access only to the people who need it.

### 1.6 Pricing and packages (US market)

| Package | What's included | Price |
|---|---|---|
| **Free proof** (lead magnet) | 25 matched candidates for one of their live roles, each with a match score and reason, delivered in 48 hrs | Free, about 1–2 hrs of your time |
| **Paid pilot** | Module 1 running on 1–2 live roles for 1 desk for 3 weeks | $1,500–$2,500 (credited toward setup if they continue) |
| **Core build** | Modules 1 + 2, ATS integration, set up for the whole team | $3,000–$7,500 one-time |
| **Full engine** | Modules 1–3 | $6,000–$10,000 one-time |
| **Monthly retainer** | Module 4 plus running costs managed | $1,500–$3,000/mo |

**The ROI line to use on calls:**
> "One extra placement a quarter is about $15–20k in fees. The retainer is $2k a month. If the system doesn't pay for itself several times over, you shouldn't keep it."

**Income path using these numbers:** 1 client on setup plus retainer gets you to about $2k/month, 3 clients to about $5–6k/month, and 5 clients to about $10k/month.

### 1.7 Delivery timeline

| Week | What happens |
|---|---|
| 0 | Discovery call; get ATS, inbox and LinkedIn access; collect 2 live job specs and the agency's candidate profile template |
| 1 | Build the intake, scoring and outreach flows; connect the ATS; warm up the sending inboxes |
| 2 | Run on 1 live role in "review mode" (a recruiter approves each message) |
| 3 | Go live on all pilot roles; the daily shortlist starts |
| 4 | Results review: candidates sourced, reply rate, screens booked. Propose the full build and retainer |

**Guarantee you can offer once you have one or two results:** "If you don't get at least 10 booked screening calls on your pilot roles in 21 days, we keep working for free until you do." Use it only after you've seen your real numbers.

---

## Part 2: Who to contact and how to find them

**Ideal client profile**
- US recruitment or staffing agency with 3–50 employees
- A clear specialty: IT, engineering, healthcare, finance and accounting, sales, legal or skilled trades
- Contingency or retained search (not pure temp staffing, at first)

**Titles to contact:** Owner, Founder, CEO, Managing Director, Managing Partner, President. At larger agencies, the Director of Recruiting or Head of Delivery.

**Buying signals (use them to personalize):**
- They're **hiring recruiters or sourcers** themselves. They're growing, and sourcing is a bottleneck.
- They have lots of open roles listed on their website or LinkedIn jobs page.
- The owner posts on LinkedIn about hard-to-fill roles.
- They recently moved to a new ATS (Loxo, Recruit CRM and so on), so they're open to change.

**Where to build the list**
- LinkedIn Sales Navigator: industry "Staffing and Recruiting", company size 2–50, United States, owner titles
- Apollo (your Apollo connector works for this), filtered the same way
- American Staffing Association member directories and niche recruiter associations
- The "Jobs" page on each agency's website, which gives you the `{{role_title}}` for personalization

**Deliverability basics (don't skip)**
- Send from a **separate domain** (for example `get[yourbrand].com`), never your main one. Warm up each inbox for 2–3 weeks.
- Send 30–50 emails per inbox per day at most. Write in plain text with no images and **no links in the first email**.
- Verify every address before sending.

**Rough funnel to plan around** (typical cold-email ranges; measure your own):
1,000 agencies contacted → 30–60 replies → 10–20 calls → 3–6 free proofs or pilots → 1–3 paying clients.

---

## Part 3: Cold email scripts

> Rule for all of these: **don't invent results or clients.** Until you have a real case study, your proof is the free sample. Once you have a result, swap it in where marked.

### Sequence A: Candidate sourcing angle (main sequence, 5 emails)

**Email 1 (Day 0)**
Subject: `{{role_title_lowercase}} search`

> Hi {{first_name}},
>
> Saw {{agency}} is working a {{role_title}} role in {{location}}. Searches like that usually mean a recruiter spending hours on boolean strings and InMails that don't get answered.
>
> I build AI sourcing systems for recruitment agencies. The system reads the job spec, finds and ranks matching candidates (including people already sitting in your ATS), writes a personal first message to each one, and books the interested ones straight onto your recruiter's calendar.
>
> I'd rather prove it than pitch it: I'll send you 25 matched candidates for that {{role_title}} role, each with a one-line reason they fit, free, within 48 hours.
>
> Want me to run it?
>
> [Your name]

---

**Email 2 (Day 3). Angle: their own database**
Subject: `your ats`

> Hi {{first_name}},
>
> One thing I see at almost every agency: some of the best candidates for a new role are already in the ATS. They applied two or three years ago and have moved up since, but nobody has time to re-read thousands of old profiles.
>
> An AI agent can do that every time a job comes in. It pulls the right 20–30 people from your own database and messages them the same day, before you pay for a single InMail.
>
> Does your team reuse the database today, or does it mostly sit there?
>
> [Your name]

---

**Email 3 (Day 7). Angle: time and cost math**
Subject: `sourcing hours`

> Hi {{first_name}},
>
> Quick math: if each recruiter spends around 2 hours a day sourcing, messaging and scheduling, that's about 40 hours a month per desk that isn't spent with clients or closing. Across {{recruiter_count}} recruiters, that adds up to a full-time hire.
>
> The system I set up takes most of that off their plate, for less than a part-time sourcer costs.
>
> *[Once you have proof, add one line here, e.g. "A {{specialty}} agency in [city] went from X to Y booked screens a week in the first month."]*
>
> Worth a 15-minute look?
>
> [Your name]

---

**Email 4 (Day 14). Angle: speed**
Subject: `first recruiter wins`

> Hi {{first_name}},
>
> With good candidates, the first recruiter who reaches them properly usually gets the conversation. Everyone after that gets "I'm already talking to someone."
>
> The agent I build replies to interested candidates within minutes, including at 9pm when they're actually reading their email, and gets the call booked before another agency gets a chance.
>
> The offer still stands: send me any open role and I'll send back 25 scored candidates in 48 hours. No call needed.
>
> [Your name]

---

**Email 5 (Day 21–28). Breakup**
Subject: `close the loop`

> Hi {{first_name}},
>
> I haven't heard back, so I'll assume the timing's off. Keeping it simple; just reply with a number:
>
> 1. Interested, send me the free candidate list
> 2. Not now, check back in 3 months
> 3. Not for us
>
> Either way, good luck filling the {{role_title}} role.
>
> [Your name]

---

### Sequence B: Business development angle (more job orders)

Use this for owners who care more about **new clients** than candidates, for example when their website shows few open roles. The `{{N}}` must be a real number you've actually pulled.

**Email 1 (Day 0)**
Subject: `{{specialty}} roles in {{metro}}`

> Hi {{first_name}},
>
> Right now there are {{N}} companies in {{metro}} with a {{specialty}} role that's been open for 30+ days. That's exactly the kind of search {{agency}} fills.
>
> I build an AI agent that finds those companies every week, identifies the hiring manager, and sends them a short, personal note from you, optionally mentioning a strong candidate you already have. You just take the calls.
>
> Want me to send over the list of those {{N}} companies? Free, no strings.
>
> [Your name]

**Email 2 (Day 4)**
Subject: `the list`

> Hi {{first_name}},
>
> I put together the {{N}} companies anyway. Here are three from the list:
>
> - {{company_1}}: {{role_1}}, open {{days_1}} days
> - {{company_2}}: {{role_2}}, open {{days_2}} days
> - {{company_3}}: {{role_3}}, open {{days_3}} days
>
> Happy to send the full list with hiring-manager names. Should I send it to you or to someone on your BD side?
>
> [Your name]

**Email 3 (Day 10). Breakup**
Subject: `last one`

> Hi {{first_name}},
>
> Last note from me. If more job orders become a priority this quarter, reply "list" and I'll send the full set of companies hiring for {{specialty}} in {{metro}}, updated for that week.
>
> [Your name]

---

## Part 4: LinkedIn scripts

**Connection request** (under 300 characters)

> Hi {{first_name}}, I build AI sourcing systems for {{specialty}} recruitment agencies. Saw {{agency}} is working a {{role_title}} role. Would be good to connect.

**Message 1 (after they accept)**

> Thanks for connecting, {{first_name}}. Quick one: how is your team finding candidates for roles like the {{role_title}} right now? Mostly LinkedIn Recruiter, the job boards, or your own database?

**Message 2 (if they answer).** Relate it to their answer, then make the offer:

> Makes sense. That's usually where most of the hours go. I'm offering a few agencies a free test: send me one live role and I'll send back 25 scored candidates with a reason for each in 48 hours. Want to try it on the {{role_title}}?

**Message 3 (if no reply after 5–7 days)**

> No worries if now's busy. If it's useful later, the free 25-candidate test is open anytime. Just send over a job spec.

---

## Part 5: Cold call script

**Opener (permission-based)**

> "Hi {{first_name}}, it's [Your name]. Full honesty, this is a cold call. Can I have 30 seconds to tell you why I called, and then you can tell me if it's worth continuing?"

**Reason for the call**

> "I build AI sourcing systems for recruitment agencies like {{agency}}. When a new job comes in, the system finds and ranks matching candidates, including people already in your ATS, messages them in your recruiter's name, and books the interested ones straight onto their calendar. I saw you're working a {{role_title}} role. How are your recruiters finding candidates for something like that right now?"

**Discovery questions** (ask 2–3 and let them talk)

1. "How many recruiters do you have, and how many roles is each one working?"
2. "Roughly how much of their day goes on sourcing and chasing replies versus talking to candidates and clients?"
3. "How often does your team go back into the ATS for past candidates when a new job comes in?"
4. "What's harder right now: finding candidates, or winning new job orders?" *(This tells you whether to lead with Module 1 or Module 3.)*
5. "What's a placement worth to you on average?" *(You'll use this for the ROI math.)*

**The close (offer the free proof)**

> "Here's what I'd suggest. Send me one live role, the {{role_title}} or any other, and I'll send back 25 matched candidates with a reason for each within 48 hours. Free. If they're good, we get on a 20-minute call and I'll show you how it runs for your whole team. Fair?"

**If they say "send me some info"**

> "Sure. So I send the right thing: is it more of a candidate problem or a job-order problem for you right now?" *(Then send the matching one-paragraph summary plus the free-proof offer.)*

---

## Part 6: Objection handling

| They say | You say |
|---|---|
| "Our ATS already has AI." | "Good, we'd use it. Most built-in AI helps search the database. What we add is the outreach, reply handling and booking on top, so candidates actually end up on a call. Want to test it against what your ATS gives you on one role?" |
| "LinkedIn Recruiter does this." | "Recruiter is a great source, and we'd use your seats. The time goes on everything after the search: writing each message, following up, handling replies, scheduling and logging. That's the part we automate." |
| "We tried automation; candidates hated the spammy messages." | "That's usually generic templates sent at volume. Every message here references the candidate's actual experience, goes out in small batches from the recruiter's own name, and you can approve messages before they send during the pilot." |
| "Too expensive." | "What's an average placement worth to you, around $15–20k? If this adds even one placement a quarter, it pays for itself several times over. And the first test is free, so you'll see quality before spending anything." |
| "My recruiters won't use another tool." | "They don't have to learn one. They get a shortlist and booked calls on their calendar, and everything is logged in the ATS they already use." |
| "What about compliance or bias?" | "Recruiters make every decision. The AI only ranks on job-relevant criteria, never protected characteristics. We follow CAN-SPAM, and we don't send cold texts. If you place in NYC or other regulated areas, we'll walk through the requirements with you." |
| "Not right now." | "Totally fair. Can I send the free 25-candidate list for your current role anyway? If it's useful, we talk next quarter; if not, no harm done." |
| "Who else have you done this for?" | *(Be honest.)* "We're early, which is why I'm offering a free test instead of asking you to trust a logo. You'll judge it on your own role." |

---

## Part 7: Discovery call agenda (20–30 minutes, after the free proof)

1. **Their reaction to the 25 candidates (5 min).** Which ones would they call? What was off? This is your proof.
2. **Current process (5 min).** Team size, ATS, sourcing tools, roles per recruiter, average fee.
3. **Pain and goals (5 min).** "If your recruiters got 10 hours a week back, what would they do with it?"
4. **Walk through the system (5 min).** Show the flow on their own role. Keep it short.
5. **Offer (5 min).** Paid pilot at $1,500–$2,500 for 3 weeks, credited toward the full build. Then the full build plus a $1.5k–$3k/mo retainer.
6. **Next step.** Agree on a start date, access and the two live roles for the pilot, and send the proposal the same day.

---

## Quick checklist before sending your first 100 emails

- [ ] Separate sending domain bought and warmed up for 2–3 weeks
- [ ] 100 US agencies listed, with owner name, verified email, specialty and one live role pulled from each website
- [ ] Free-proof workflow tested on at least 3 real job specs, so you can deliver 25 candidates in 48 hrs
- [ ] Calendar booking link ready
- [ ] Sequence A loaded; Sequence B ready for agencies with few open roles
- [ ] Tracking sheet: sent, replied, call booked, proof sent, pilot, client
