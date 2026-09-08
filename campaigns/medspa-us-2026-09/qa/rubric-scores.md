# QA gate — Section 3 scoring rubric

Scored against the master T1 skeleton in `templates/t1.txt`, since the fixed
blocks carry six of the seven principles and the per-lead `hook` / `angle`
carry the seventh. D3 requires 6+/7 before a live batch.

## T1 — master skeleton

| Principle | Y/N | Where it lands |
|---|---|---|
| Give First | **Y** | The `hook` gives away a real, unflattering observation about their operation — the coverage gap, the unanswered reviews, the demand-to-staff ratio — with no ask attached. Rank 5 volunteers a disqualifying fact (Vagaro isn't supported) before any ask at all. |
| Micro-Commitments | **Y** | The ask is fifteen minutes on a pre-existing link, not a pilot, not a contract. The pilot is described, never requested. |
| Social Proof | **Y** | Named client (Skin Alive Clinic), named scale (four clinics), matched reference group (dermatology and laser). No number is claimed that can't be defended. |
| Authority | **Y** | "I build one thing" — no hedging, no "I could maybe help." The `angle` names specific mechanism (pending bookings, two-hour callback clock, contraindication gates) that only a builder would know. |
| Rapport | **Y** | Every `hook` is drawn from that clinic's own review count, staff size, tenure, city and opening hours. Tone is flat and operational — matches how clinic owners talk about their own back office. |
| Scarcity | **N** | **Deliberately absent.** No fake urgency (D1 principle 6: fake scarcity kills trust instantly). The real constraint — how many pilots can run at once — isn't known yet, so it isn't claimed. |
| Shared Identity | **Y** | In-group vocabulary throughout: pending vs. confirmed bookings, no-show recovery, dormant at 45 days, contraindication gates, LegitScript, per-location hours. Written "I", never "we". |

**Score: 6/7 — clears the D3 gate for a live batch.**

The missing principle is scarcity, and it is missing on purpose. Once you know
your real capacity ("I can run three pilots this quarter"), add it to the offer
line and it becomes 7/7. Do not add it before it's true.

## T2–T5

| Touch | Score | Note |
|---|---|---|
| T2 | 5/7 | Short ping by design (D10). Carries micro-commitment, authority, shared identity, rapport, give-first. Deliberately thin. |
| T3 | 6/7 | Mechanism + the HIPAA architecture. Heaviest authority and shared-identity load in the sequence. |
| T4 | 6/7 | Give-first is strongest here: it argues against its own sale by naming where these deployments fail. |
| T5 | 6/7 | Breakup. Reply-with-a-number is the lowest-friction micro-commitment in the sequence and the only touch with no link. |

## D7 red-flag pass — automated, runs on every build

`build.py` fails the build on any of these in T1:

- corporate "we" / "our team"
- "AI" / "bot" / "chatbot" self-branding
- a stated price
- more than one link
- body over 165 words
- unfilled `PLACEHOLDER` values in `config.json`

Current status: **all pass.** Length range 114–163 words, mean 139.

## Deliberate deviations from the directives

Two, both at your explicit instruction — recorded here so the decision is
traceable rather than accidental:

1. **Links in cold email.** D7 says avoid entirely. You chose one CTA, the
   booking link, in T1–T4. Mitigation: exactly one link per email, same
   destination every time, no tracking parameters, no image, no HTML
   signature. Send plain text.
2. **Five touches, not two.** D10 says start at exactly two and earn the rest.
   You chose five. Mitigation in `README.md`: launch T1+T2 only, enable T3–T5
   once T1 reply rate is established.
