# Flow48 — SME Underwriting Ingestion Prototype

A working prototype built for a specific conversation with Flow48 (Dubai).

Flow48 does revenue-based financing for SMEs, promises **disbursement within 48 hours of onboarding**, operates in the **UAE and South Africa**, and is **expanding into Saudi Arabia**. Their Series A press release states the money goes toward *"alternative data sources and advanced risk assessment tools."*

This prototype answers the question that follows from that: **when you enter the third market, do you build the ingestion layer again, or once?**

---

## Run it

```bash
python3 run.py
```

No dependencies. Python 3.10+. Sample statements are generated on first run if missing.

```bash
python3 make_samples.py     # regenerate the synthetic statements
python3 add_rule.py hyperpay  # the live fix (see below)
python3 add_rule.py --undo    # reset before the next demo
```

---

## What it does

Three SME applicants, three banks, three countries, three genuinely different export formats:

| Applicant | Bank | Country | Format quirks |
|---|---|---|---|
| Al Naseem Restaurant Group | Mashreq | 🇦🇪 UAE, AED | `DD/MM/YYYY`, separate debit/credit columns, comma thousands |
| Kruger Online Retail | FNB | 🇿🇦 South Africa, ZAR | `YYYY-MM-DD`, signed single column, 4-row junk preamble |
| Riyadh Home Essentials | Al Rajhi | 🇸🇦 Saudi, SAR | `DD-MM-YYYY`, **Arabic column headers**, comma thousands |

The pipeline takes each raw export to a priced, explainable credit decision:

```
raw CSV → adapter → canonical transactions → underwriting features
        → weighted risk score → decision + advance size + factor rate
        → exceptions routed to an analyst
```

**Zero lines of code differ between the three markets.** A bank is a JSON file in `adapters/`.

---

## The five things worth pointing at

### 1. A new market is a config file
`adapters/sa_alrajhi.json` is the entire Saudi integration. Arabic headers, different date format, different currency — no code. That is the direct answer to *"per market, or once?"*

### 2. It refuses to guess
The Saudi applicant takes 42% of its income through HyperPay, which no rule covers. The pipeline does **not** assume it's revenue. It excludes it, sizes the advance on what it can prove, and reports the gap as a named, fixable rule.

Silently guessing here is how you over-advance and lose money.

### 3. Financing inflows are kept out of revenue
The South African applicant received a ZAR 520,000 director transfer. Counted as revenue, that inflates the advance by roughly a third of a month's turnover. The pipeline strips it out and says so.

This is the single most expensive mistake in revenue-based underwriting.

### 4. Unassessable ≠ zero
When 42% of inflows are unclassified, revenue concentration cannot be judged. Scoring it zero would produce a confident wrong number and penalise the applicant for a *data* gap. Instead the factor is marked `n/a` and the remaining weights are renormalised.

### 5. Credit policy is data, not code
`rules/income_rules.json` holds the classification rules. A credit analyst adds a newly-supported processor without an engineer and without a deploy.

---

## The live moment

Run `python3 run.py` — the Saudi applicant is **referred to an analyst**, because 42% of its income is unrecognised.

Then add one line:

```bash
python3 add_rule.py hyperpay
python3 run.py
```

| | Before | After |
|---|---|---|
| Recognised revenue | SAR 153,057/mo | **SAR 261,776/mo** |
| Concentration | not assessable | 58% (assessable) |
| Decision | REFER TO ANALYST | **APPROVED** |
| Advance offered | SAR 196,448 | **SAR 334,626** |
| Straight-through rate | 67% | **100%** |

One JSON entry. No code, no deploy, no engineer. That is what "build it once" buys.

---

## Layout

```
run.py                      orchestration + the terminal report
make_samples.py             deterministic synthetic statement generator
add_rule.py                 the live rule fix
adapters/                   one JSON per bank — this is the integration
  ae_mashreq.json
  za_fnb.json
  sa_alrajhi.json           Arabic headers, zero code
rules/income_rules.json     credit policy as data
pipeline/
  ingest.py                 adapter-driven parsing → canonical transactions
  features.py               underwriting feature extraction
  score.py                  transparent scoring, sizing, exception routing
sample_data/                generated CSVs in three real-world formats
```

---

## Honest scope

**This is a prototype, not a credit model.**

- All data is **synthetic**. No real merchant, account or institution is represented.
- The scoring weights are **illustrative**. A production model would be fitted on Flow48's own default history, not hand-set.
- Classification is keyword-based. Production would want a trained classifier with keyword rules as the fallback and audit layer.
- No PDF or image statement parsing, no bank API connections, no data retention or PII handling — all of which a live system needs.

What it does demonstrate is the **architecture**: adapter-driven ingestion, policy-as-data, explainable scoring, and exception routing that tells you precisely what to fix.

Built in a few hours to make one point concretely rather than argue it on a call.
