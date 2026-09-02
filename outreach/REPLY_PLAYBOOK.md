# Reply-handling playbook — Microns med spa campaign

Companion to `MASTER_send_list.csv`. The campaign is 739 sendable leads × up to 5 touches
over 22 waves (8 Sep – 27 Oct). This is what happens when they answer.

At the benchmark rates in `references/benchmarks.md` — 4–5.8% reply, ~48% of replies
positive — 739 first touches plus follow-ups should produce **roughly 30–55 replies, of
which 15–25 are worth a conversation, and 1–3 become clients.** Follow-ups carry more than
half of it. Plan the calendar for that, not for a flood.

---

## 0 · The four rules that apply to every reply

**1. Answer inside four business hours, or don't bother.** A cold reply has a half-life
measured in hours. If the inbox can't be watched that closely, send fewer per day.

**2. One ask per reply, and never more than the last one.** They replied to "worth
exploring?" — the next ask is a 15-minute call, not a signed pilot.

**3. Match their length.** A two-line reply gets a two-line answer. Sending four paragraphs
to someone who wrote "how much?" is the fastest way to lose them.

**4. Honour every stop.** "Not interested," "remove me," a breakup email you sent, or
silence after touch 5 — all of them mean that address never hears from us again. Mark the
row and mean it. Google's spam-complaint threshold is 0.1%; on 739 addresses that is
**less than one complaint** before the domain starts suffering.

---

## 1 · Triage — sort every reply within one minute

| Bucket | What it looks like | Route |
|---|---|---|
| **A. Interested** | "Tell me more", "sure, send times", any question about how it works | §2.1 — book the call |
| **B. Price first** | "How much?", "What does it cost?" | §2.2 |
| **C. Send info** | "Send me a deck / one-pager / link" | §2.3 |
| **D. Proof** | "Who else uses this?", "Any med spas?" | §2.4 — **the hard one** |
| **E. Already have it** | Podium, Weave, Vagaro, Boulevard, Zenoti, Mangomint, an answering service | §2.5 |
| **F. Compliance** | "Is this HIPAA compliant?", "Do you sign a BAA?" | §2.6 |
| **G. Not now** | "Check back in Q1", "we're mid-renovation" | §2.7 |
| **H. No** | "Not interested", "remove me", "unsubscribe" | §2.8 — one line, then stop |
| **I. Hostile** | Angry, threatens to report as spam | §2.9 — apologise, remove, never reply twice |
| **J. Wrong person** | "That's our manager", "email the owner" | §2.10 |
| **K. Corporate decides** | Chain/franchise sites | §2.11 |
| **L. Auto-reply** | OOO, ticket confirmation, "we received your message" | §2.12 — no human touched it |
| **M. Bounce** | Hard or soft | §2.13 |
| **N. 1-2-3** | Reply to the breakup email: "2" | §2.14 |

---

## 2 · Responses

Every template below is a starting point, not a script. Rewrite the first line to reference
what they actually said. Sign with a real name and a real physical address — CAN-SPAM
requires the address on every commercial message, including replies in a cold thread.

### 2.1 Interested

> Good to hear. Easiest way to do this is 15 minutes where you tell me what your phone
> actually does after hours and I tell you honestly whether this helps.
>
> [Two specific slots, their timezone.] Either work? If neither, send a time and I'll take it.

Then, before that call, do the homework you couldn't do at scale: their booking software,
their real hours, what their last twenty reviews complain about. Fifteen minutes of that
is the difference between a discovery call and an interrogation.

**On the call, qualify hard on four things:**
1. **Volume.** Roughly how many inbound calls a week, and what share go to voicemail? If
   they don't know, that's an answer — nobody logs missed calls, which is the whole problem.
2. **Booking system.** Vagaro, Boulevard, Zenoti, Mangomint, Aesthetic Record, paper. If
   there's no API into it, the pending-booking mechanic doesn't work and you should say so.
3. **Who decides.** Owner, practice manager, or a franchise office. Anything past two
   people is a longer sale than this campaign is built for.
4. **What breaks first.** Let them name it. Pitch the one automation that matches; do not
   pitch the stack. A five-person practice cannot absorb five automations.

### 2.2 Price first

Don't dodge it — dodging price reads as expensive.

> Pricing depends on which of these you actually turn on — the phone piece alone is a
> different number from the full set, and most practices your size should only turn on one.
>
> [PRICE — fill this in before the campaign sends. A range is fine. "Let's discuss" is not.]
>
> Fastest way to get you a real number is 15 minutes. If it's out of range after that,
> you've lost a quarter of an hour and I've lost a prospect who was never going to buy.

> **Fill in your actual pricing before wave 1 goes out.** A reply that can't answer "how
> much" wastes the best lead the campaign will produce.

### 2.3 Send info

Requests for a deck are usually a polite exit. Give them something real, then re-ask small.

> Sending a deck would be me guessing which half applies to you. Instead — one paragraph on
> the piece I think fits [Practice], and if it lands, 15 minutes.
>
> [Two sentences on the single automation that matches their situation.]
>
> Want the longer version?

### 2.4 Proof — "who else uses this?"

**This is the question the campaign is weakest on, and lying about it ends the business.**
There are no customers to name yet. Say so.

> Straight answer: you'd be early. I don't have a med spa case study to show you and I'm not
> going to invent one — you'd find out in a week and rightly never speak to me again.
>
> What I can show you is the thing itself: how a booking is written as pending rather than
> confirmed, what happens when someone asks a clinical question, and how patient data is
> de-identified before it reaches a model. Fifteen minutes, screen shared, and you can judge
> the build instead of a slide.
>
> If being first isn't for you, that's a completely reasonable no.

Two things make this work: offering a discount for being first (say it plainly — early
customers are paying in risk), and asking for a reference in exchange. **The first signed
client's real number replaces touch 3 in `followup_library.md` across the entire campaign.**

### 2.5 "We already have Podium / Weave / a service"

Don't attack the incumbent. Find the gap it structurally has.

> Makes sense — [tool] handles [what it's genuinely good at] well.
>
> The gap I'd check: when someone calls at 8pm asking what Daxxify costs, does [tool] quote
> your actual price and put a slot on the calendar, or does it take a message? Most of them
> take a message. That's the part I built.
>
> If yours books, you're covered and I'll leave it there. Worth thirty seconds to check?

For a human answering service: the gap is that they take messages and don't know your
pricing or your fifth-Saturday rule. For Podium/Weave: they're strong on texting and
reviews, weaker on booking a specific slot from an after-hours conversation.

### 2.6 Compliance — HIPAA, BAA

Answer precisely. Vagueness here loses medical buyers permanently.

> Fair question, and it's the one I'd ask first too.
>
> Patient data is encrypted per-field, not just at rest. Anything that goes to a language
> model is de-identified before it's sent — in production the system refuses to send a
> prompt still carrying an identifier. The orchestration layer only ever sees UUIDs and
> booleans, never names or numbers.
>
> On a BAA: [ANSWER HONESTLY — whether you sign one today, and if not, what the timeline is.
> Do not say yes if the answer is "we could".]
>
> Happy to walk your compliance person through the architecture directly.

> **Decide your BAA answer before wave 1.** Every serious medical buyer asks, and "I'll
> check" costs you the deal.

### 2.7 Not now

Don't argue with timing. Bank it precisely.

> Understood. I'll come back [the month they named] rather than drip at you in between.
>
> One thing worth doing in the meantime regardless of me: [one specific, free suggestion for
> their situation]. Costs nothing and it's the same problem either way.

Then actually calendar it. A "check back in March" you honour in March converts far better
than the original cold email did.

### 2.8 No

One line. No rebuttal, no "just curious what changed."

> Understood — removing you now. Good luck with [practice].

Mark the row `SUPPRESSED`. Add the address to a permanent suppression list that survives
this campaign and every future one.

### 2.9 Hostile

> Apologies — that's on me. You're removed and won't hear from me again.

Send it once. Do not defend the email, do not explain the research, do not reply to anything
further from that address. Remove and move on.

### 2.10 Wrong person

> Thanks — happy to write to [name] instead. Is [address] the best way, or would you rather
> forward it?

Asking them to forward often works better than a cold email to the new address; the forward
arrives warm. Never email both people — 10+ contacts at one company drops reply rates from
7.8% to 3.8%.

### 2.11 Corporate decides (chains and franchises)

This is exactly what the multi-site touch 1 asked for, so treat it as a win.

> That's what I was hoping to hear — I'd rather have one conversation than seven.
>
> If you can point me at whoever owns patient communications across the network, I'll stop
> writing to locations entirely.

Then genuinely stop. Mark every other site in that brand `HOLD — corporate contact in
progress`. The 6 rows already flagged `HOLD` in the CSV are there for this reason.

### 2.12 Auto-reply

No human has seen the email. Do not treat it as a reply and do not "follow up on your
auto-response." If the OOO names a covering colleague, that's a real lead — write to them
fresh. If it names a return date, resume the sequence after it.

Ticketing auto-replies (`support@`, `help@`) mean the address is a helpdesk queue, not a
decision-maker. Downgrade the row and look for a better address.

### 2.13 Bounces

**Hard bounce** — remove immediately, permanently. Never retry. Bounce rate above 4% starts
hurting deliverability; above 7.5% is where domains get throttled. On this list the 22
`DO NOT SEND` rows exist specifically to keep the bounce rate down; do not be tempted to
send to them "just to see."

**Soft bounce** — full mailbox or a temporary block. Retry once, seven days later. If it
soft-bounces twice, treat it as hard.

**If bounces exceed 4% in any wave, stop the campaign and re-verify the remaining list**
before sending wave n+1. Deliverability lost is far more expensive than a delayed send.

### 2.14 The 1-2-3 breakup replies

- **"1"** → §2.1, and reply within the hour. This person just raised their hand at the last
  possible moment; they are the warmest lead in the whole sequence.
- **"2"** → §2.7. Calendar it for exactly the interval they named.
- **"3"** → §2.8. Suppress. Do not send a "thanks anyway" — the breakup already said this
  was the last email, and a reply to "3" makes you a liar.
- **Silence** → suppress at the same standard. The breakup promised no further contact.

---

## 3 · Things never to say in a reply

- Any customer count, growth figure, or result that hasn't happened. "Practices see 30%
  fewer no-shows" is the sentence that ends this business.
- A named client. There are none.
- "Our AI books appointments." It books *pending* appointments. The distinction is the
  entire reason a medical practice would trust it — do not blur it to sound stronger.
- Anything implying the system answers clinical questions. It refuses them. That's a
  feature, and it's the first thing a physician will test you on.
- "Just circling back", "just checking in", "did you see my last email" — a 12% drop in
  booking rate, per Gong, and it's the same in a reply thread as in a follow-up.
- Pressure language. "Act now" stacking raises spam flagging by 67%.

---

## 4 · What to log, per reply

Add these columns to your working copy of the CSV as replies come in:

`Reply date` · `Bucket (A–N)` · `Replied to touch #` · `Outcome` · `Next action date` · `Notes`

Two numbers tell you whether the campaign works, and they're worth more than any other
reporting:

1. **Which touch produced the reply.** If most come from T1, the follow-ups are weak. If
   most come from T3–T5, the first email is weak. Both are fixable, but only if measured.
2. **Which sequence segment replies.** There are eight (`Sequence segment` column). If
   `coverage` replies at 6% and `early` at 0.5%, stop sending to `early` and put the effort
   into more coverage-segment leads.

---

## 5 · When to stop the whole thing

Stop sending and fix the list if any of these hit:

| Signal | Threshold | Why |
|---|---|---|
| Bounce rate | >4% in a wave | Domain reputation damage starts here |
| Spam complaints | 1 (one) | Google's threshold is 0.1%; on 739 sends that's <1 |
| Reply rate after 3 waves | <1% | The copy or the targeting is wrong, more volume won't fix it |
| Negative replies | >30% of replies | The offer is landing wrong for this market |

---

## 6 · Before wave 1 goes out

Nothing in this playbook works if the sending setup is wrong. In order:

1. **Dedicated domain**, not the primary one. If the campaign burns a domain, it must not be
   the one the business runs on.
2. **Warm it for 3–4 weeks** before wave 1 — that's why the schedule ramps 20 → 40/day
   rather than opening at full volume.
3. **SPF, DKIM and DMARC** all passing. Without them a cold campaign at this volume is a
   spam folder with extra steps.
4. **Physical mailing address and a working unsubscribe** in every email. CAN-SPAM, and it
   is not optional because the list is B2B.
5. **Fill in the two blanks in this file**: pricing (§2.2) and the BAA answer (§2.6).
6. **Verify the 37 `VERIFY ADDRESS BEFORE SEND` rows.** Two minutes each on their website.
   Montclair Rejuvenation Center alone is 1,398 reviews.
7. **Do not send the 22 `DO NOT SEND` rows.** Their copy is written and waiting; find the
   real addresses first. NakedMD Beverly Hills (650 reviews), âme Spa (651) and The Skin
   Center (576) are worth the ten minutes each.
