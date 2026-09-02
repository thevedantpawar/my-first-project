import re, os, json, glob

FILES = ["p1_emails.md","p2_emails.md","core_small_emails.md","pool1_emails.md",
         "handwritten_p4_001-055.md","handwritten_p4_056-120.md","handwritten_p4_121-162.md",
         "handwritten_p2_001-040.md","handwritten_p2_041-078.md",
         "handwritten_p3_tierB.md","handwritten_p5_chains.md",
         "handwritten_p6_001-070.md","handwritten_p6_071-145.md",
         "handwritten_p6_146-232.md","handwritten_p6_233-333.md",
         "handwritten_p6_334-437.md"]

EMAIL_RE = r"[A-Za-z0-9_.+\-]+@[A-Za-z0-9_.+\-]+"

def blocks(text):
    """yield (header, body) for '## ' style entries"""
    parts = re.split(r"\n(?=## )", text)
    for p in parts[1:]:
        lines = p.split("\n")
        yield lines[0][3:].strip(), "\n".join(lines[1:])

def parse_file(fn):
    text = open(fn).read()
    out = []
    # style B: **NNN · Business** · email · rating/reviews · *subject*
    for m in re.finditer(r"^\*\*(\d+)\s*·\s*(.+?)\*\*\s*·\s*("+EMAIL_RE+r")\s*·\s*([^·\n]*)·\s*\*(.+?)\*\s*\n(.*?)(?=\n\s*\n|\n---|\Z)",
                         text, re.S|re.M):
        idx, biz, email, meta, subj, body = m.groups()
        out.append(dict(src=fn, idx=int(idx), business=biz.strip(), email=email.strip(),
                        subject=subj.strip(), body=body.strip(), style="B"))
    # style A: ## N · Business — City, ST · ...  /  **email** · **Subject:** subj / body
    for hdr, body in blocks(text):
        m = re.match(r"(\d+)\s*·\s*(.+)", hdr)
        if not m: continue
        idx, rest = int(m.group(1)), m.group(2)
        biz = re.split(r"\s+—\s+|\s+·\s+", rest)[0].strip()
        em = re.search(r"\*\*("+EMAIL_RE+r")\*\*\s*·\s*\*\*Subject:\*\*\s*(.+)", body)
        if not em:
            m2 = re.search(r"\*\*To:\*\*\s*("+EMAIL_RE+r")", body)
            m3 = re.search(r"\*\*Subject:\*\*[ \t]*(.+)", body)
            em = None
            if m2 and m3:
                class _M:
                    def __init__(s,a,b,e): s._g=(a,b); s._e=e
                    def group(s,i): return s._g[i-1]
                    def end(s): return s._e
                em = _M(m2.group(1), m3.group(1).strip(), m3.end())
        if not em:
            continue
        email, subj = em.group(1), em.group(2).strip()
        rest_body = body[em.end():].strip()
        rest_body = re.split(r"\n---", rest_body)[0].strip()
        out.append(dict(src=fn, idx=idx, business=biz, email=email,
                        subject=subj, body=rest_body, style="A"))
    return out

all_e = []
for f in FILES:
    got = parse_file(f)
    print(f"{f:34s} {len(got):4d}")
    all_e += got
print("TOTAL", len(all_e))
json.dump(all_e, open("/tmp/claude-0/-home-user-my-first-project/eb291d7c-ea41-5811-8ce3-909c4805a2a1/scratchpad/handwritten.json","w"), indent=1)
