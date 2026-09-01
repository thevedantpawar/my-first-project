#!/usr/bin/env python3
"""
Med spa cold outbound enrichment pipeline.

Reads the raw Google Maps (Apify) scrape, classifies every email by
deliverability risk, de-duplicates multi-location chains, derives
per-lead personalization signals from VERIFIED fields only, and emits
send-ready segments plus a suppression list.

Deliberately does NOT use `has_online_booking` / `ai_qualification_notes`:
those columns are scraper artifacts (99.4% of rows say "No"; live checks
of a sample found online booking present every time). Building copy on a
false claim is the fastest way to lose a reply.
"""
import csv, re, sys, json, collections
from urllib.parse import urlparse

SRC = sys.argv[1]
OUT = sys.argv[2].rstrip("/")

# ---------------------------------------------------------------- helpers
FREE = {"gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com",
        "me.com","comcast.net","msn.com","live.com","sbcglobal.net"}
JUNK_DOM = {"domain.com","example.com","email.com","company.com","mysite.com",
            "mystore.com","sentry-next.wixpress.com","wixpress.com","greensock.com",
            "sentry.io","yourdomain.com","site.com","website.com"}
JUNK_LOCAL = {"user","name","first.last","example","email","youremail","your",
              "username","test","noreply","no-reply","donotreply"}
# vendor/agency addresses that are not the clinic
VENDOR_HINT = re.compile(r"(redspotinteractive|wixpress|sentry|greensock|squarespace|godaddy|"
                         r"webmaster|hostmaster|postmaster|abuse|accessibility)", re.I)

ROLE_GOOD = ("info","hello","contact","frontdesk","front.desk","office","concierge",
             "appointments","booking","reception","admin","care","careteam","spa","clinic")

def domain(u):
    u = (u or "").strip()
    if not u.startswith("http"):
        return ""
    try:
        h = urlparse(u).netloc.lower()
    except Exception:
        return ""
    return h[4:] if h.startswith("www.") else h

def norm_hours(h):
    # the export is mojibake'd UTF-8; normalise the narrow no-break spaces
    return (h or "").replace("â€¯"," ").replace(" "," ").replace("\xa0"," ")

def closed_days(h):
    h = norm_hours(h)
    out = []
    for part in h.split("|"):
        if ":" not in part:
            continue
        day = part.split(":")[0].strip()
        if day and "closed" in part.lower():
            out.append(day)
    return out

def open_days(h):
    h = norm_hours(h)
    out = []
    for part in h.split("|"):
        if ":" not in part:
            continue
        day = part.split(":")[0].strip()
        if day and "closed" not in part.lower():
            out.append(day)
    return out

def to_int(v):
    v = (v or "").strip().replace(",","")
    return int(v) if v.isdigit() else 0

def to_float(v):
    try:
        return float((v or "").strip())
    except ValueError:
        return 0.0

# ------------------------------------------------- spam / compliance guard
BANNED_WORDS = {
 "get","bank","credit","access","open","compare","problem","now","billing","deal",
 "finance","financial","claims","insurance","mortgage","soon","new","performance",
 "freedom","home","sales","medical","urgent","life","marketing","investment",
 "diagnostics","friend","cash","invoice","extra","purchase"}
BANNED_PHRASES = [
 "free consultation","special offer","limited time","act now","click here","risk-free",
 "weight loss","no obligation","money-back guarantee","guaranteed results","best price",
 "great fit","circle back","compare notes","one time","off chance","doctor recommended",
 "safe and effective","100% free","increase revenue","increase sales","buy now","order now",
 "sign up free","free trial","free quote","today","amazing","exclusive deal"]

def spam_flags(text):
    """Return list of violations. Word bans are whole-token; phrases substring."""
    t = text.lower()
    hits = []
    for w in re.findall(r"[a-z']+", t):
        if w in BANNED_WORDS:
            hits.append(f"word:{w}")
    for p in BANNED_PHRASES:
        if p in t:
            hits.append(f"phrase:{p}")
    if "—" in text or "–" in text:
        hits.append("style:em-dash")
    if re.search(r"\b[A-Z]{4,}\b", text):
        hits.append("style:allcaps")
    if "!!" in text:
        hits.append("style:multi-bang")
    return sorted(set(hits))

# service names safe to echo (banned tokens stripped out)
SERVICE_SAFE = {
 "Laser hair removal service":"laser hair removal",
 "Facial spa":"facials",
 "Skin care clinic":"skin care",
 "Tattoo removal service":"tattoo removal",
 "Hair removal service":"hair removal",
 "Wellness center":"wellness",
 "Day spa":"day spa",
 "Plastic surgery clinic":"surgical work",
 "Dermatologist":"derm",
 "Waxing hair removal service":"waxing",
 "Massage therapist":"massage",
 "Permanent make-up clinic":"permanent makeup",
 "Hair transplantation clinic":"hair restoration",
}


# ------------------------------------------------- company name sanitising
# Per the spam-word rules: if a banned token appears inside a company name,
# rewrite the DISPLAYED name so the token is gone while keeping it readable.
# Conservative on purpose: strip only at the edges, and revert whenever the
# strip would leave a fragment that no longer reads as a name.
EDGE_TOKENS = (r"medical\s+spa|med\s*spa|medi\s*spa|medspa|medical\s+aesthetics|"
               r"medical|medicine|weight\s*loss|new\s+york|nyc")
RE_LEAD  = re.compile(r"^(?:%s)\b[\s,&/-]*" % EDGE_TOKENS, re.I)
RE_TRAIL = re.compile(r"[\s,&/-]*\b(?:%s)$" % EDGE_TOKENS, re.I)
CONNECTORS = {"at","and","of","by","the","in","for","on","with","to","a","&"}

def _tidy(n):
    n = re.sub(r"\s{2,}", " ", n)
    n = re.sub(r"\s+([:,.])", r"\1", n)             # no space before , : .
    n = re.sub(r"[\s,:&/\-]+$", "", n)              # no dangling punctuation
    n = re.sub(r"^[\s,:&/\-]+", "", n)
    return n.strip()

def _deshout(n, original):
    """De-shout only when the ORIGINAL name was entirely uppercase. Judging the
    stripped remainder instead would turn a surviving initialism (AJC, AYA)
    into a word."""
    letters = [c for c in original if c.isalpha()]
    if not letters or not all(c.isupper() for c in letters):
        return n
    return " ".join(w.capitalize() if w.isalpha() else w for w in n.split())

def display_name(raw):
    base = re.sub(r"\(.*?\)", " ", (raw or "").strip())
    base = re.split(r"\s+[-\u2013\u2014]\s+", base)[0]      # drop " - Location" suffix
    original = _tidy(base) or (raw or "").strip()

    n = original
    for _ in range(3):                                # peel repeated edge tokens
        before = n
        n = _tidy(RE_TRAIL.sub("", _tidy(RE_LEAD.sub("", n))))
        if n == before:
            break

    n = re.sub(r"[\s,&/-]*\b(?:pllc|llc|inc|pc|p\.c\.|ltd)\.?$", "", n, flags=re.I).strip()
    while n.split() and n.split()[-1].lower() in CONNECTORS:
        n = " ".join(n.split()[:-1])
    n = _tidy(n)

    # revert if stripping gutted the name or left a dangling connector
    first = n.split()[0].lower() if n.split() else ""
    if len(n) < 3 or first in CONNECTORS:
        n = original
    return _deshout(n, original) or original

# ------------------------------------------------- first-line generation
def first_line_candidates(rec):
    """Return ordered candidate lines (best signal first). Caller picks the
    first one that passes the spam scan, so a banned token in a city or
    clinic name degrades gracefully instead of shipping a flagged line."""
    name   = rec["display_name"]
    city   = rec["safe_city"]
    rc     = rec["review_count"]
    rating = rec["rating"]
    cl     = rec["closed_list"]
    svc    = rec["safe_services"]
    i      = rec["rotor"]
    inc    = f" around {city}" if city else ""
    incity = f" in {city}" if city else ""

    sun = "Sunday" in cl
    sat = "Saturday" in cl
    mon = "Monday" in cl
    out = []

    if sun and rc >= 150:
        out += [
          (f"{rc} Google reviews at {rating} says the demand{inc} is already there, and the listing has you closed Sundays.", "weekend_gap_high_demand"),
          (f"Your listing shows Sundays closed, which is the same window most of those {rc} reviewers are scrolling.", "weekend_gap_high_demand"),
          (f"{rating} across {rc} reviews, and the calendar still shows Sunday dark.", "weekend_gap_high_demand"),
        ]
    if sun and sat:
        out += [
          (f"Saturday and Sunday both read closed on your listing, which is when a lot of aesthetic searches happen.", "full_weekend_closed"),
          (f"The listing has {name} dark both weekend days.", "full_weekend_closed"),
          (f"Weekends show closed on your Google profile, Saturday and Sunday.", "full_weekend_closed"),
        ]
    if sun:
        out += [
          (f"Your Google hours show Sundays closed{incity}.", "sunday_closed"),
          (f"Sunday reads closed on the listing, which tends to be a heavy browsing day for injectables.", "sunday_closed"),
          (f"Noticed Sundays are dark on your listing.", "sunday_closed"),
        ]
    if rc >= 300:
        out += [
          (f"{rc} reviews at {rating} is a lot of traffic running through one front desk.", "high_volume_phone_load"),
          (f"{rating} across {rc} reviews suggests the phone rarely stops.", "high_volume_phone_load"),
          (f"{rc} reviews is real volume for a single location.", "high_volume_phone_load"),
        ]
    if mon:
        out += [
          (f"Mondays read closed on your listing, so weekend voicemails land Tuesday.", "monday_closed"),
          (f"Your listing shows Monday dark, which stacks the weekend callbacks.", "monday_closed"),
          (f"Monday closed on the profile means two days of missed calls to clear.", "monday_closed"),
        ]
    if len(svc) >= 3:
        out += [
          (f"{svc[0]}, {svc[1]} and {svc[2]} under one roof is a wide menu for one phone line.", "service_breadth"),
          (f"Running {svc[0]} alongside {svc[1]} means a lot of different pricing questions.", "service_breadth"),
        ]
    out += [
      (f"{rating} on Google{incity} is a hard number to hold.", "rating_floor"),
      (f"Holding {rating} stars says the chair-side work is dialed in.", "rating_floor"),
      (f"{rating} on Google puts you above most of the field.", "rating_floor"),
    ]
    # rotate so neighbouring rows do not share phrasing
    k = i % 3
    return out[k:] + out[:k]


def _unused_first_line(rec):
    """
    Build ONE personalization line from verified scrape fields only.
    Priority: strongest real signal first. Never references booking software,
    never invents a fact. Rotating phrasings avoid template fingerprinting.
    """
    name   = rec["display_name"]
    city   = rec["city"]
    rc     = rec["review_count"]
    rating = rec["rating"]
    cl     = rec["closed_list"]
    svc    = rec["safe_services"]
    i      = rec["rotor"]

    sun = "Sunday" in cl
    sat = "Saturday" in cl
    mon = "Monday" in cl

    # A. weekend gap + demand proof (strongest, most actionable)
    if sun and rc >= 150:
        v = [
          f"{rc} Google reviews at {rating} says the demand around {city} is already there, and the listing has you closed Sundays.",
          f"Your listing shows Sundays closed, which is the same window most of those {rc} reviewers are scrolling.",
          f"{rating} across {rc} reviews, and the calendar still shows Sunday dark in {city}.",
        ]
        return v[i % 3], "weekend_gap_high_demand"

    if sun and sat:
        v = [
          f"Saturday and Sunday both read closed on your listing, which is when a lot of {city} aesthetic searches happen.",
          f"The listing has {name} dark both weekend days in {city}.",
          f"Weekends show closed on your Google profile, Saturday and Sunday.",
        ]
        return v[i % 3], "full_weekend_closed"

    if sun:
        v = [
          f"Your Google hours show Sundays closed in {city}.",
          f"Sunday reads closed on the listing, which tends to be a heavy browsing day for injectables.",
          f"Noticed Sundays are dark on your {city} listing.",
        ]
        return v[i % 3], "sunday_closed"

    # B. high review volume, open 7 days: phone load is the pain
    if rc >= 300:
        v = [
          f"{rc} reviews at {rating} is a lot of {city} traffic running through one front desk.",
          f"{rating} across {rc} reviews suggests the phone rarely stops in {city}.",
          f"{rc} reviews is real volume for a single {city} location.",
        ]
        return v[i % 3], "high_volume_phone_load"

    # C. Monday closed
    if mon:
        v = [
          f"Mondays read closed on your listing, so weekend voicemails land Tuesday.",
          f"Your {city} listing shows Monday dark, which stacks the weekend callbacks.",
          f"Monday closed on the profile means two days of missed calls to clear.",
        ]
        return v[i % 3], "monday_closed"

    # D. service breadth
    if len(svc) >= 3:
        v = [
          f"{svc[0]}, {svc[1]} and {svc[2]} under one roof in {city} is a wide menu for one phone line.",
          f"Running {svc[0]} alongside {svc[1]} in {city} means a lot of different pricing questions.",
          f"The {city} menu spans {svc[0]} through {svc[2]}.",
        ]
        return v[i % 3], "service_breadth"

    # E. floor: rating + city (always true)
    v = [
      f"{rating} on Google in {city} is a hard number to hold.",
      f"Holding {rating} in {city} says the chair-side work is dialed in.",
      f"{rating} stars in {city} puts you above most of the field.",
    ]
    return v[i % 3], "rating_floor"

# subject line must match the signal the first line opens on
SUBJECT_BY_SIGNAL = {
    "weekend_gap_high_demand": "sunday calls",
    "sunday_closed":           "sunday calls",
    "full_weekend_closed":     "weekend calls",
    "high_volume_phone_load":  "front desk",
    "monday_closed":           "monday backlog",
    "service_breadth":         "pricing questions",
    "rating_floor":            "front desk",
}

# ---------------------------------------------------------------- main
rows = list(csv.DictReader(open(SRC, encoding="utf-8", errors="replace")))
seen_email = {}
recs = []

for idx, r in enumerate(rows):
    email = (r.get("email") or "").strip().lower()
    web   = domain(r.get("website"))
    name  = (r.get("business_name") or "").strip()
    city  = (r.get("city") or "").strip()
    state = (r.get("state_region") or "").strip()

    local, _, edom = email.partition("@")

    # --- tier / suppression decision
    tier, reason = None, ""
    if not re.match(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", email):
        tier, reason = "SUPPRESS", "invalid or blank email"
    elif edom in JUNK_DOM or local in JUNK_LOCAL or "example" in edom:
        tier, reason = "SUPPRESS", "scraper placeholder, would hard bounce"
    elif VENDOR_HINT.search(email):
        tier, reason = "SUPPRESS", "vendor or agency address, not the clinic"
    elif email in seen_email:
        tier, reason = "SUPPRESS", f"duplicate of row {seen_email[email]} (multi-location chain)"
    elif web and (edom == web or edom.endswith("." + web) or web.endswith("." + edom)):
        tier, reason = "A", "email domain matches clinic website"
    elif edom in FREE:
        tier, reason = "B", "free provider, real but likely personal"
    else:
        tier, reason = "C", "corporate domain does not match website, verify before send"

    if tier != "SUPPRESS":
        seen_email[email] = idx + 2

    cl  = closed_days(r.get("hours"))
    od  = open_days(r.get("hours"))
    svc_raw = [s.strip() for s in (r.get("services") or "").split(",") if s.strip()]
    svc = [SERVICE_SAFE[s] for s in svc_raw if s in SERVICE_SAFE]

    rec = {
        "row": idx + 2,
        "business_name": name,
        "display_name": display_name(name),
        "city": city, "state": state,
        "email": email, "website": r.get("website","").strip(),
        "website_domain": web,
        "phone": (r.get("phone") or "").strip(),
        "rating": to_float(r.get("google_rating")),
        "review_count": to_int(r.get("review_count")),
        "closed_list": cl,
        "closed_days": ";".join(cl),
        "open_days_count": len(od),
        "safe_services": svc,
        "safe_city": "" if spam_flags(city) else city,
        "tier": tier, "tier_reason": reason,
        "rotor": idx,
    }
    if tier != "SUPPRESS":
        chosen, sig, flags = "", "", ["none-clean"]
        for cand, csig in first_line_candidates(rec):
            f = spam_flags(cand)
            if not f:
                chosen, sig, flags = cand, csig, []
                break
            if not chosen:
                chosen, sig, flags = cand, csig, f
        rec["first_line"] = chosen
        rec["signal_used"] = sig
        rec["spam_flags"] = ";".join(flags)
        rec["subject"] = SUBJECT_BY_SIGNAL.get(sig, "front desk")
    else:
        rec["first_line"] = ""
        rec["signal_used"] = ""
        rec["spam_flags"] = ""
        rec["subject"] = ""
    recs.append(rec)

# ---------------------------------------------------------------- outputs
cols = ["row","tier","tier_reason","business_name","display_name","city","state","email","website",
        "phone","rating","review_count","closed_days","open_days_count",
        "signal_used","subject","first_line","spam_flags"]

def dump(path, rs):
    with open(path,"w",newline="",encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rs: w.writerow(r)

dump(f"{OUT}/enriched_all.csv", recs)
dump(f"{OUT}/send_tier_a.csv",  [r for r in recs if r["tier"]=="A"])
dump(f"{OUT}/send_tier_b.csv",  [r for r in recs if r["tier"]=="B"])
dump(f"{OUT}/review_tier_c.csv",[r for r in recs if r["tier"]=="C"])
dump(f"{OUT}/suppress.csv",     [r for r in recs if r["tier"]=="SUPPRESS"])

tc = collections.Counter(r["tier"] for r in recs)
sc = collections.Counter(r["signal_used"] for r in recs if r["signal_used"])
flagged = [r for r in recs if r["spam_flags"]]

summary = {
  "total_rows": len(recs),
  "tiers": dict(tc),
  "sendable_A_plus_B": tc["A"] + tc["B"],
  "signals_used": dict(sc),
  "first_lines_with_spam_flags": len(flagged),
}
open(f"{OUT}/summary.json","w").write(json.dumps(summary, indent=2))

print("=== TIERS ===")
for t in ["A","B","C","SUPPRESS"]:
    print(f"{tc[t]:6d}  {t}")
print(f"\nSendable now (A+B): {tc['A']+tc['B']}")
print(f"Needs verification (C): {tc['C']}")
print(f"Suppressed: {tc['SUPPRESS']}")
print("\n=== PERSONALIZATION SIGNAL MIX ===")
for k,v in sc.most_common(): print(f"{v:6d}  {k}")
print(f"\n=== SPAM QA ===\nfirst lines with violations: {len(flagged)}")
for r in flagged[:10]:
    print("  ", r["business_name"], "->", r["spam_flags"])
