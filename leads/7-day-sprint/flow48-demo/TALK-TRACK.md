# How to run this on the call — 6 minutes

**Before you dial:** run `python3 add_rule.py --undo`, then `python3 run.py` once to confirm it's in the starting state (Saudi applicant referred, 67% straight-through). Have the terminal already open and font size up.

---

### 0:00 — Frame it before you show anything

> "Before we talk scope, I built the thing. It's synthetic data, but it's your actual problem. Can I share my screen for four minutes?"

Never open with the code. Open with why it exists.

---

### 0:30 — The setup

> "Three SME applicants. One in the UAE on Mashreq, one in South Africa on FNB, one in Saudi on Al Rajhi. Three different date formats, three currencies, two different debit-credit conventions, and the Saudi statement has Arabic column headers.
>
> That's the problem you're about to have three times over."

**Run `python3 run.py`.** Let it finish. Say nothing while it scrolls.

---

### 1:30 — The line that matters

Scroll to the summary block and read it out:

> "Zero lines of code changed between those three markets. A bank is a JSON file."

Open `adapters/sa_alrajhi.json` on screen.

> "That's the entire Saudi integration. Arabic headers, different date format, different currency. When you go live in Riyadh, this is the work."

**Then stop talking.** This is the point they need a second to absorb.

---

### 2:30 — The one that gets the technical respect

Scroll to Kruger Online Retail.

> "This one had a 520,000 rand transfer from a director. If you count that as trading revenue you over-advance by about a third of a month's turnover. It's stripped out and reported — see the 'excluded' line."

Then the Saudi applicant:

> "And this one got referred to an analyst. Not because the business is bad — the score is 88. It's referred because 42% of its income comes through HyperPay, and no rule covers HyperPay yet.
>
> It didn't guess. It sized the advance on what it could prove and told you exactly which rule is missing. Silently guessing is how you lose money on a book like this."

Point at the concentration row showing `n/a`:

> "And it won't score a factor it can't assess. Zero would be a confident wrong number. It neutralises it and renormalises the rest."

*This is the moment a data-minded founder decides whether you're serious. Al Rifai was Chief Strategy and Data Officer at Glovo — he will notice this specifically.*

---

### 4:00 — The close

> "So watch what fixing that referral looks like."

```bash
python3 add_rule.py hyperpay
python3 run.py
```

> "Revenue goes from 153 to 262 thousand. Referral becomes an approval. Advance goes from 196 to 335 thousand. Straight-through rate 67% to 100%.
>
> One line in a JSON file. No code, no deploy, no engineer. That's what building the ingestion layer once instead of per market actually buys you."

---

### 5:00 — Transition to the offer. Do not pitch a project.

> "That took me a few hours on synthetic data. What I'd want to do next is five days on your real formats — map what actually arrives from each bank, cost what the manual handling is costing you monthly, and build one production-shaped piece you keep either way.
>
> Fifteen hundred dollars, fixed, and it comes off the build if you commission one. Want me to start Monday?"

**Then be quiet.** The first person to speak after a price loses.

---

## If they ask hard questions

**"What about PDF statements?"**
> "Not in this — this is CSV and structured exports. PDF and scanned statements are a real chunk of work and I'd want to scope them against your actual mix. That's part of what the five days would tell us."

**"Our data is much messier than this."**
> "It always is. That's why the teardown works on your real exports rather than my samples. The architecture is what I'm showing you — that a format is config, not code. The mess is what I'd be pricing."

**"Our risk model is proprietary / much more sophisticated."**
> "It should be, and I'd never touch it. The scoring here is a placeholder to make the pipeline runnable end to end. What I'd build is everything upstream — getting clean, normalised, complete features into *your* model. That's the part that decides whether 48 hours holds."

*This answer matters. Do not let them think you're proposing to replace their credit model.*

**"Why should we pay for something you built in an afternoon?"**
> "You're not paying for the afternoon. You're paying for the five days on your real formats, and the fact that I turn up already knowing the shape of the problem."

**"Can you do this for free as a trial?"**
> "The call's free. The teardown is paid because you get working code and a costed process map, and it's fully credited if you go ahead. If you work with me at all, it costs you nothing."

---

## Things that will kill it

- **Opening with the code.** Frame first, always.
- **Talking over the run.** Let it scroll in silence — it's more impressive than narration.
- **Saying "AI agents."** Say what breaks and what it costs. They get ten AI pitches a week.
- **Offering to replace their risk model.** You'll be dismissed instantly. You do ingestion; they do credit.
- **Filling the silence after the price.** Ask, then stop.
