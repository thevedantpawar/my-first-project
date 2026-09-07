# -*- coding: utf-8 -*-
"""Reconstruct the MICRONS site from the mirrored Lovable SSR output + apply the 6 changes.
Reads the mirrored build in the website folder, writes a clean static index.html."""
import re, pathlib

SITE = pathlib.Path(__file__).resolve().parent.parent
src = (SITE / ".reference" / "microns-lovable-ssr.html").read_text(encoding="utf-8")

# ---------------------------------------------------------------- body
body = src.split("<body>", 1)[1].rsplit("</body>", 1)[0]
body = re.sub(r"<!--\$-->|<!--/\$-->|<!-- -->", "", body)
body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
body = re.sub(r'<aside\s+id="lovable-badge".*?</aside>', "", body, flags=re.S)
body = re.sub(r"<script.*?</script>", "", body, flags=re.S)
body = body.replace("translate-y-5 opacity-0", "reveal")
body = re.sub(r'\sstyle="transition-delay:\d+ms"', "", body)
body = body.strip()

# ---------------------------------------------------------------- 1. hero CallRecoveryFlow steps
def flow_step(t, label, tone="fg"):
    col = {"fg": "text-foreground", "mut": "text-muted-foreground", "pri": "text-primary"}[tone]
    return (f'<li class="flex items-start gap-3"><span class="mt-0.5 font-display text-[0.6875rem] '
            f'font-semibold tracking-[0.14em] text-primary/60 tabular-nums">{t}</span>'
            f'<span class="text-[0.875rem] font-medium leading-snug {col}">{label}</span></li>')

hero_flow = "".join([
    flow_step("9:47", "Incoming call \u2014 unknown number"),
    flow_step("9:47", "Call missed. No voicemail.", "mut"),
    flow_step("9:47", "Microns sends a text: \u201cSorry we missed you \u2014 booking a consult, or a question about a treatment?\u201d"),
    flow_step("9:52", "\u201cBotox consult, please.\u201d \u2192 offered Tue 2:00 or Thu 11:00", "mut"),
    flow_step("9:54", "Consultation booked \u2014 before you opened.", "pri"),
])
body = body.replace('<ol class="mt-5 space-y-3"></ol>',
                    f'<ol class="mt-5 space-y-3" id="hero-flow">{hero_flow}</ol>')

# ---------------------------------------------------------------- 2. demo scenarios
def demo_rows(rows):
    out = []
    for time, who, text, tone in rows:
        tc = {"sys": "text-ink-muted", "in": "text-ink-foreground", "ai": "text-champagne",
              "win": "text-champagne font-semibold"}[tone]
        out.append(
            f'<li class="flex gap-4"><span class="shrink-0 pt-0.5 font-display text-[0.6875rem] '
            f'font-semibold tracking-[0.12em] text-champagne/70 tabular-nums">{time}</span>'
            f'<span class="text-[0.9375rem] leading-relaxed {tc}">'
            + (f'<span class="mr-1.5 font-display text-[0.625rem] uppercase tracking-[0.14em] text-champagne/60">{who}</span>' if who else "")
            + f'{text}</span></li>')
    return "".join(out)

DEMOS = {
 "missed": demo_rows([
    ("9:47", "", "Incoming call \u2014 unknown number.", "sys"),
    ("9:47", "", "Call missed. No voicemail left.", "sys"),
    ("9:47", "Microns", "\u201cHi Sarah, sorry we missed your call. What can we help you with today?\u201d", "ai"),
    ("9:48", "Sarah", "\u201cLooking to book a Botox consultation.\u201d", "in"),
    ("9:49", "Microns", "\u201cHappy to help \u2014 Tuesday 2:00 PM or Thursday 11:00 AM?\u201d", "ai"),
    ("9:51", "Sarah", "\u201cTuesday, please.\u201d", "in"),
    ("9:51", "", "Consultation booked \u00b7 Tue 2:00 PM \u00b7 summary sent to the front desk.", "win"),
 ]),
 "web": demo_rows([
    ("2:14", "", "Web form submitted \u2014 \u201cInterested in laser hair removal.\u201d", "sys"),
    ("2:14", "Microns", "Text + email: \u201cHi Jenna, thanks for reaching out. A package, or a single session?\u201d", "ai"),
    ("2:20", "Jenna", "\u201cA package \u2014 and rough pricing.\u201d", "in"),
    ("2:21", "Microns", "Sends the package overview, offers Wed 4:00 PM or Fri 10:00 AM.", "ai"),
    ("2:26", "Jenna", "\u201cFriday at 10.\u201d", "in"),
    ("2:26", "", "Consultation booked \u00b7 Fri 10:00 AM \u00b7 lead source tagged in the CRM.", "win"),
 ]),
 "noshow": demo_rows([
    ("11:00", "", "Consultation scheduled \u2014 client has not arrived.", "sys"),
    ("11:20", "Microns", "\u201cHi Mara, we had you at 11 today \u2014 everything ok? Want another time?\u201d", "ai"),
    ("11:34", "Mara", "\u201cSo sorry, something came up.\u201d", "in"),
    ("11:35", "Microns", "\u201cNo problem. Tomorrow 1:00 PM or Thursday 9:30 AM?\u201d", "ai"),
    ("11:41", "Mara", "\u201cTomorrow at 1.\u201d", "in"),
    ("11:41", "", "Rebooked \u00b7 Tomorrow 1:00 PM \u00b7 flagged for a same-day reminder.", "win"),
 ]),
}
body = body.replace('<ol class="mt-6 space-y-3" aria-live="polite"></ol>',
                    f'<ol class="mt-6 space-y-3" aria-live="polite" id="demo-log">{DEMOS["missed"]}</ol>')

# tag the three scenario tab buttons for JS
body = body.replace('text-champagne">Missed call<span', 'text-champagne" data-demo="missed">Missed call<span', 1)
body = body.replace('hover:text-ink-foreground">Web lead<span', 'hover:text-ink-foreground" data-demo="web">Web lead<span', 1)
body = body.replace('hover:text-ink-foreground">No-show<span', 'hover:text-ink-foreground" data-demo="noshow">No-show<span', 1)

# ---------------------------------------------------------------- 3. FAQ answers
FAQ = [
 ("radix-_R_2d6aq_", "No. MICRONS is designed to support the gaps your team cannot always cover \u2014 after hours, during treatments and when multiple inquiries arrive at once. Your front desk stays in charge; the system covers the overflow."),
 ("radix-_R_2l6aq_", "The system and its messaging are designed around your business. You review and approve every message before it goes live, so the tone matches how your team already speaks to clients."),
 ("radix-_R_2t6aq_", "No. The goal is to build around your existing workflow wherever practical \u2014 your CRM, phone system, calendar and forms stay where they are."),
 ("radix-_R_356aq_", "Most initial systems can be scoped and implemented in approximately two weeks, depending on the complexity of the integrations."),
 ("radix-_R_3d6aq_", "Systems are monitored and maintained as part of ongoing support. If something goes wrong, it is our job to catch it and fix it."),
 ("radix-_R_3l6aq_", "No. Ongoing support is month-to-month, with no annual contract."),
]
for rid, ans in FAQ:
    pat = re.compile(r'(<div data-state="closed" id="' + re.escape(rid) + r'"[^>]*?) hidden=""([^>]*>)</div>')
    body = pat.sub(lambda m: m.group(1) + m.group(2) +
                   f'<div class="pb-7 pr-4 text-[0.9375rem] leading-relaxed text-muted-foreground faq-answer" hidden>{ans}</div></div>', body)

# ---------------------------------------------------------------- 4. results section (between why-microns and pricing)
RESULTS = '''<section id="results" class="relative scroll-mt-24 px-5 py-24 sm:px-8 md:py-32 bg-surface text-surface-foreground"><div class="mx-auto w-full max-w-6xl"><div class="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16"><div class="reveal transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"><p class="rule-label text-primary"><span aria-hidden="true" class="h-px w-8 bg-primary/40"></span>Proof of work</p><h2 class="text-balance text-[clamp(2rem,5.2vw,3.9rem)] font-semibold leading-[1.02] mt-6">We&#x27;ve built this before<span class="block text-primary">for a clinic down the road.</span></h2><div class="mt-8 space-y-5 text-[1.0625rem] leading-relaxed text-muted-foreground"><p>Before MICRONS, we built the consultation-booking system for a multi-location skin &amp; laser clinic in our own city. Same problem, smaller scale: inquiries scattered across phone, email and Instagram, with no consistent way for the front desk to pick them up in the morning.</p><p class="font-display text-xl font-medium leading-snug text-foreground">Every inquiry now arrives the same way &mdash; structured, time-stamped and ready to book &mdash; instead of being pieced back together from three inboxes.</p><p class="text-[0.9375rem]">Client name withheld. This is our own build, not a stock testimonial.</p></div></div><div class="reveal transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"><div class="rounded-2xl border border-border bg-card p-7 shadow-editorial sm:p-9"><p class="eyebrow text-primary">What we built</p><ul class="mt-4 space-y-4 text-[0.9375rem] text-foreground"><li class="flex gap-3"><span aria-hidden="true" class="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50"></span>A structured consultation request on their website &mdash; treatment concern, preferred date, contact details &mdash; in place of a generic &ldquo;contact us&rdquo; box.</li><li class="flex gap-3"><span aria-hidden="true" class="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50"></span>Every submission routed to the front desk in one consistent format, ready to action.</li><li class="flex gap-3"><span aria-hidden="true" class="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50"></span>After-hours inquiries captured around the clock instead of lost to voicemail.</li><li class="flex gap-3"><span aria-hidden="true" class="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50"></span>Automated confirmation to the client so the conversation does not go quiet.</li></ul><p class="hairline mt-7 pt-5 text-[0.8125rem] text-muted-foreground">The same building blocks behind every MICRONS system \u2014 applied to the front door instead of the whole funnel.</p></div></div></div></div></section>'''
body = body.replace('</section><section id="pricing"', '</section>' + RESULTS + '<section id="pricing"', 1)

# ---------------------------------------------------------------- 7. trust strip (above the fold)
CHECK = ('<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" '
         'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>')

def _trust(text):
    return '<p class="trust-item text-muted-foreground">' + CHECK + '<span>' + text + '</span></p>'

TRUST = ('<section id="trust" class="relative border-b border-border bg-background px-5 py-6 '
         'text-foreground sm:px-8"><div class="mx-auto w-full max-w-6xl">'
         '<p class="eyebrow text-primary">Founding-partner program \u00b7 now onboarding a limited '
         'number of U.S. med spas</p>'
         '<div class="mt-5 grid gap-x-8 gap-y-3 md:grid-cols-2">'
         + _trust('Built only for U.S. med spas \u2014 not a general-purpose chatbot.')
         + _trust('Clinical questions stop the AI and go straight to your staff.')
         + _trust('Built around the CRM, calendar and phone system you already run.')
         + _trust('You approve every patient-facing message before it goes live.')
         + '</div></div></section>')

body = body.replace('<section id="problem"', TRUST + '<section id="problem"', 1)

# ---------------------------------------------------------------- 8. safety & compliance
_REVEAL = ('reveal transition-[opacity,transform] duration-700 '
           '[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none')

def _li(text):
    return ('<li class="flex gap-3"><span aria-hidden="true" class="mt-2 size-1.5 shrink-0 '
            'rounded-full bg-primary/50"></span>' + text + '</li>')

COMPLIANCE = (
 '<section id="safety" class="relative scroll-mt-24 px-5 py-24 sm:px-8 md:py-32 bg-background text-foreground">'
 '<div class="mx-auto w-full max-w-6xl"><div class="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">'
 '<div class="' + _REVEAL + '">'
 '<p class="rule-label text-primary"><span aria-hidden="true" class="h-px w-8 bg-primary/40"></span>Safety</p>'
 '<h2 class="text-balance text-[clamp(2rem,5.2vw,3.9rem)] font-semibold leading-[1.02] mt-6">'
 'Built for healthcare,<span class="block text-primary">not just chat.</span></h2>'
 '<div class="mt-8 space-y-5 text-[1.0625rem] leading-relaxed text-muted-foreground">'
 '<p>A med spa inbox is not an ordinary inbox. Some messages are commercial and some are clinical, '
 'and an automation that cannot tell the difference is a liability rather than an asset.</p>'
 '<p class="font-display text-xl font-medium leading-snug text-foreground">So the clinical boundary '
 'is enforced by the platform itself \u2014 not left to a prompt.</p>'
 '<p>Every inbound message is classified before any agent sees it. Your own keyword list can widen '
 'that net. Nothing can narrow it.</p></div></div>'
 '<div class="' + _REVEAL + '">'
 '<div class="rounded-2xl border border-border bg-card p-7 shadow-editorial sm:p-9">'
 '<p class="eyebrow text-primary">What is built in</p>'
 '<ul class="mt-4 space-y-4 text-[0.9375rem] text-foreground">'
 + _li('When a clinical question is detected the AI stops, sends your clinic-approved response, '
       'pauses automation on that conversation and assigns an urgent task to your staff.')
 + _li('Escalation alerts bypass quiet hours and message frequency caps, so an urgent message is '
       'never held back by a scheduling rule.')
 + _li('Replies are grounded only in knowledge you have approved. The system does not improvise '
       'about treatments, pricing or suitability.')
 + _li('Role-based access, per-clinic data isolation, and an audit log covering every action the '
       'system takes.')
 + _li('Opt-outs take effect immediately, and no patient data is written to system logs.')
 + _li('Encryption in transit as standard. Encryption at rest, data retention and per-state '
       'messaging consent rules are set with you during deployment.')
 + '</ul>'
 '<p class="hairline mt-7 pt-5 text-[0.8125rem] text-muted-foreground">MICRONS handles the '
 'non-clinical, commercial side of your practice. It does not diagnose, prescribe, assess treatment '
 'suitability, interpret images or provide clinical judgement. It is not a medical device and it is '
 'not a system of record for clinical data. Before any patient data is processed, the deployment is '
 'reviewed against HIPAA, applicable state law and TCPA/CTIA messaging rules.</p>'
 '</div></div></div></div></section>')

body = body.replace('<section id="pricing"', COMPLIANCE + '<section id="pricing"', 1)

# ---------------------------------------------------------------- 9. nav links for the new section
_m = re.search(r'(<a href="#why-microns" class="relative[^"]*">)Why Microns</a>', body)
assert _m, "desktop nav anchor for #why-microns not found"
body = body.replace(
    _m.group(0),
    _m.group(0) + _m.group(1).replace('#why-microns', '#safety') + 'Safety</a>',
    1)


# ---------------------------------------------------------------- 6 + 1. audit: form + Calendly
# left CTA: mailto -> Calendly popup + scroll helper
body = body.replace(
 '<a href="mailto:hello@microns.ai?subject=Revenue%20Leak%20Audit" class="group mt-9 inline-flex min-h-12 items-center gap-3 rounded-full bg-champagne px-7 text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-champagne-foreground shadow-editorial transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">Book your free audit',
 '<a href="#book-panel" data-calendly class="group mt-9 inline-flex min-h-12 items-center gap-3 rounded-full bg-champagne px-7 text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-champagne-foreground shadow-editorial transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">Book a discovery call', 1)

BOOK_PANEL = '''<div id="book-panel" class="scroll-mt-24 rounded-2xl border border-ink-border bg-ink-foreground/[0.04] p-6 sm:p-8"><p class="eyebrow text-champagne">Pick a time</p><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">Choose a slot that suits you. Confirmation lands in your inbox straight away.</p><div id="calendly-inline" class="mt-6 overflow-hidden rounded-xl border border-ink-border" style="min-width:280px;height:700px" data-url="https://calendly.com/vedantpawar3690/30min?hide_gdpr_banner=1&background_color=1a1a1a&text_color=f5f3ef&primary_color=e8d5b5"></div><p class="mt-4 text-[0.75rem] leading-relaxed text-ink-muted">20 minutes \u00b7 no obligation.</p></div>'''

# insert the form as a new right-hand column inside the audit grid, before the existing 3-step <ol> wrapper
_audit_anchor = '<div class="transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none reveal"><ol class="space-y-4"><li class="group flex gap-5 rounded-2xl border border-ink-border'
assert _audit_anchor in body, "audit anchor not found"
body = body.replace(
 _audit_anchor,
 '<div class="transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none reveal">' + BOOK_PANEL + '<p class="eyebrow text-champagne mt-10">What the call covers</p><ol class="space-y-4 mt-4"><li class="group flex gap-5 rounded-2xl border border-ink-border',
 1)

# ---------------------------------------------------------------- 5 (nav). mobile menu panel
NAVPANEL = ('<div id="mobile-nav" class="md:hidden">'
 '<div class="flex flex-col">'
 '<a href="#how-it-works" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">How it works</a>'
 '<a href="#systems" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">Systems</a>'
 '<a href="#why-microns" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">Why Microns</a>'
 '<a href="#safety" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">Safety</a>'
 '<a href="#results" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">Proof</a>'
 '<a href="#faq" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">FAQ</a>'
 '<a href="#audit" class="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-5 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-primary-foreground">Book a revenue leak audit</a>'
 '</div></div>')
body = body.replace('</nav></header>', '</nav>' + NAVPANEL + '</header>', 1)

# ---------------------------------------------------------------- 3 (footer). legal + contact links
FOOTNAV = ('<nav class="mt-8 flex flex-wrap gap-4 border-t border-border pt-6 text-[0.8125rem] text-muted-foreground">'
 '<a class="hover:text-foreground" href="mailto:ved@micronsai.com">ved@micronsai.com</a>'
 '<a class="hover:text-foreground" data-calendly href="https://calendly.com/vedantpawar3690/30min">Book a call</a>'
 '<a class="hover:text-foreground" href="/privacy.html">Privacy Policy</a>'
 '<a class="hover:text-foreground" href="/terms.html">Terms of Service</a>'
 '</nav>')
body = body.replace('<div class="mt-10 flex flex-col gap-3 border-t border-border pt-6',
                    FOOTNAV + '<div class="mt-6 flex flex-col gap-3 border-t border-border pt-6', 1)

# ---------------------------------------------------------------- HEAD
ORG_LD = '''<script type="application/ld+json">{"@context":"https://schema.org","@type":["Organization","ProfessionalService"],"name":"MICRONS","description":"AI revenue-recovery and front-desk automation built exclusively for medical spas in the United States.","url":"__SITE__/","email":"ved@micronsai.com","areaServed":{"@type":"Country","name":"United States"},"knowsAbout":["Med spa automation","AI front desk for med spas","Missed call automation","Lead response automation","No-show recovery","Review automation"],"makesOffer":[{"@type":"Offer","name":"Starter system","priceCurrency":"USD","price":"1500"},{"@type":"Offer","name":"Revenue recovery build"},{"@type":"Offer","name":"Ongoing optimization","priceCurrency":"USD","price":"750"}]}</script>'''

# ---------------------------------------------------------------- analytics
# GA4 is scaffolded but dormant until a Measurement ID is set. `gtag` is always
# defined, so every track() call downstream is safe with or without an ID, and
# nothing is requested from Google until that ID exists.
ANALYTICS = '''
<script>
  /* ==================================================================
     ANALYTICS - paste your GA4 Measurement ID below to switch on.
     Find it at analytics.google.com -> Admin -> Data streams -> Web.
     While it is empty nothing loads and nothing is sent.
     ================================================================== */
  window.MICRONS_ANALYTICS = { ga4: "" };   /* e.g. "G-XXXXXXXXXX" */

  (function(){
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    var id = (window.MICRONS_ANALYTICS || {}).ga4;
    if(!id) return;                      /* dormant: queue only, no network */
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
    window.gtag("js", new Date());
    window.gtag("config", id, { anonymize_ip: true });
  })();
</script>'''

HEAD = '''<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MICRONS \u2014 AI Revenue Recovery for U.S. Med Spas</title>
<meta name="author" content="MICRONS"/>
<meta name="description" content="MICRONS builds AI systems that recover missed calls, respond to leads instantly and follow up automatically \u2014 so your med spa stops losing bookings when the front desk is busy or after hours."/>
<link rel="canonical" href="__SITE__/"/>
<meta property="og:title" content="MICRONS \u2014 AI Revenue Recovery for U.S. Med Spas"/>
<meta property="og:description" content="AI automation that recovers missed calls, responds to leads instantly and follows up automatically for medical spas in the United States."/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="__SITE__/"/>
<meta property="og:image" content="__SITE__/assets/og-cover.jpg"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="MICRONS \u2014 AI Revenue Recovery for U.S. Med Spas"/>
<meta name="twitter:description" content="AI automation that recovers missed calls, responds to leads instantly and follows up automatically for medical spas in the United States."/>
<meta name="twitter:image" content="__SITE__/assets/og-cover.jpg"/>
<meta name="theme-color" content="#f6f3ec"/>
<link rel="icon" href="/favicon.ico" type="image/x-icon"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@500;600;700;800&display=swap"/>
<link rel="stylesheet" href="/assets/styles-vcDe33lo.css"/>
<link rel="stylesheet" href="https://assets.calendly.com/assets/external/widget.css"/>
''' + ORG_LD + '''
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Will AI replace my front desk?","acceptedAnswer":{"@type":"Answer","text":"No. MICRONS is designed to support the gaps your team cannot always cover after hours, during treatments and when multiple inquiries arrive at once."}},{"@type":"Question","name":"Will my clients know they are talking to an automated system?","acceptedAnswer":{"@type":"Answer","text":"The system and messaging are designed around your business. You review and approve messaging before it goes live."}},{"@type":"Question","name":"Do I need to change my CRM or booking software?","acceptedAnswer":{"@type":"Answer","text":"No. The goal is to build around your existing workflow wherever practical."}},{"@type":"Question","name":"How long does implementation take?","acceptedAnswer":{"@type":"Answer","text":"Most initial systems can be scoped and implemented in approximately two weeks, depending on the complexity of the integrations."}},{"@type":"Question","name":"What happens if something breaks?","acceptedAnswer":{"@type":"Answer","text":"Systems are monitored and maintained as part of ongoing support."}},{"@type":"Question","name":"Do I have to sign a long-term contract?","acceptedAnswer":{"@type":"Answer","text":"No. Ongoing support is month-to-month."}}]}</script>
<style>
  .reveal{opacity:0;transform:translateY(1.25rem)}
  .reveal.in{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){.reveal{opacity:1!important;transform:none!important}}
  .mf{display:flex;flex-direction:column;gap:.4rem}
  .mf > span{font-size:.6875rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-muted,#a79b88)}
  .mf input,.mf select{min-height:2.75rem;border-radius:.6rem;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
    padding:0 .85rem;color:#f5f3ef;font:inherit;font-size:.9375rem}
  .mf select{padding:.6rem .85rem}
  .mf input:focus,.mf select:focus{outline:2px solid #e8d5b5;outline-offset:0;border-color:transparent}
  .mf select option{color:#111}
  #mobile-nav{position:fixed;left:0;right:0;top:5rem;z-index:40;background:var(--background,#f6f3ec);
    border-bottom:1px solid var(--border,#e6ddcb);padding:.5rem 1.25rem 2rem;transform-origin:top;
    transform:scaleY(0);opacity:0;transition:transform .3s ease,opacity .3s ease}
  #mobile-nav.open{transform:none;opacity:1}
  #mobile-nav a{display:block}
  .calendly-inline-widget{min-width:280px}
  @media (max-width:768px){
    #top .relative.overflow-hidden.rounded-2xl{position:static!important;left:auto!important;bottom:auto!important;width:100%!important;margin-top:1.5rem}
    #systems .grid, #demo .grid, #how-it-works ol{gap:1.5rem}
    .max-w-6xl{overflow-x:clip}
  }
  #mobile-cta{position:fixed;left:0;right:0;bottom:0;z-index:45;display:none;padding:.7rem .9rem calc(.7rem + env(safe-area-inset-bottom));
    background:color-mix(in srgb,var(--background,#f6f3ec) 92%,transparent);backdrop-filter:blur(10px);border-top:1px solid var(--border,#e6ddcb)}
  #mobile-cta a{display:flex;min-height:2.9rem;align-items:center;justify-content:center;border-radius:999px;background:var(--primary,#7a1f2b);
    color:#fff;font-family:"Sora",sans-serif;font-size:.75rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
  @media (max-width:768px){#mobile-cta{display:block}body{padding-bottom:4.5rem}}
  /* utilities referenced in markup that the JIT stylesheet never emitted */
  .underline{text-decoration-line:underline}
  @media (min-width:640px){.sm\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}}
  /* trust strip */
  .trust-item{display:flex;align-items:flex-start;gap:.6rem;font-size:.875rem;line-height:1.45}
  .trust-item svg{margin-top:.15rem;flex:0 0 auto;color:var(--primary,#7a1f2b)}
</style>''' + ANALYTICS

APP_JS = '''<script src="https://assets.calendly.com/assets/external/widget.js" defer></script>
<script>
(function(){
  "use strict";
  var CAL = "https://calendly.com/vedantpawar3690/30min";
  var $=function(s,c){return (c||document).querySelector(s)};
  var $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
  var reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;

  // ------- analytics -------
  // Safe with or without a GA4 ID: gtag is always defined, and with no ID the
  // events queue into dataLayer and go nowhere. Never send PII (name, email,
  // phone, clinic name) - only the qualifying answers.
  function track(name, params){
    try{ window.gtag("event", name, params || {}); }catch(_){}
  }
  window.micronsTrack = track;

  // ------- reveal on scroll -------
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } });
  }, {threshold:.12, rootMargin:"0px 0px -8% 0px"});
  $$(".reveal").forEach(function(el){ io.observe(el); });

  // ------- sticky nav border -------
  var hdr = $("header");
  addEventListener("scroll", function(){
    hdr.classList.toggle("border-border", scrollY > 8);
    hdr.style.background = scrollY > 8 ? "color-mix(in srgb,var(--background,#f6f3ec) 90%,transparent)" : "";
    hdr.style.backdropFilter = scrollY > 8 ? "blur(10px)" : "";
  }, {passive:true});

  // ------- mobile menu -------
  var burger = $('button[aria-label="Open menu"]'), panel = $("#mobile-nav");
  if(burger && panel){
    var setM=function(o){ panel.classList.toggle("open",o); burger.setAttribute("aria-expanded",o?"true":"false"); document.body.style.overflow=o?"hidden":""; };
    burger.addEventListener("click", function(){ setM(!panel.classList.contains("open")); });
    $$("a",panel).forEach(function(a){ a.addEventListener("click", function(){ setM(false); }); });
  }

  // ------- CTA click tracking -------
  $$('a[href^="#book"], [data-calendly], #mobile-cta a').forEach(function(a){
    a.addEventListener("click", function(){
      var sec = a.closest("section");
      track("cta_click", {
        cta_text: (a.textContent || "").trim().slice(0, 60),
        cta_section: (sec && sec.id) || (a.closest("#mobile-cta") ? "mobile-sticky" : "header")
      });
    });
  });

  // ------- scroll depth -------
  (function(){
    var hit = {}, marks = [25, 50, 75, 100];
    addEventListener("scroll", function(){
      var h = document.documentElement,
          max = (h.scrollHeight - innerHeight);
      if(max <= 0) return;
      var pct = (scrollY / max) * 100;
      marks.forEach(function(m){
        if(!hit[m] && pct >= m){ hit[m] = 1; track("scroll_depth", { percent: m }); }
      });
    }, {passive:true});
  })();

  // ------- smooth anchor scroll -------
  $$('a[href^="#"]').forEach(function(a){
    a.addEventListener("click", function(e){
      var id=a.getAttribute("href"); if(id.length<2||a.hasAttribute("data-calendly")) return;
      var t=document.querySelector(id); if(!t) return;
      e.preventDefault(); t.scrollIntoView({behavior:reduce?"auto":"smooth",block:"start"});
      history.replaceState(null,"",id);
    });
  });

  // ------- FAQ accordion -------
  $$('#faq [data-radix-collection-item]').forEach(function(btn){
    var region = document.getElementById(btn.getAttribute("aria-controls") || "") ||
                 btn.closest("div[data-state]").querySelector('[role="region"]');
    var ans = region && region.querySelector(".faq-answer");
    btn.addEventListener("click", function(){
      var open = btn.getAttribute("aria-expanded") === "true";
      if(!open){ track("faq_open", { question: (btn.textContent || "").trim().slice(0, 80) }); }
      $$('#faq [data-radix-collection-item]').forEach(function(b){
        b.setAttribute("aria-expanded","false");
        var r=b.closest("div[data-state]"); r.setAttribute("data-state","closed");
        var reg=r.querySelector('[role="region"]'); if(reg){reg.hidden=true; var a=reg.querySelector(".faq-answer"); if(a)a.hidden=true;}
        b.setAttribute("data-state","closed");
      });
      if(!open){
        btn.setAttribute("aria-expanded","true"); btn.setAttribute("data-state","open");
        var wrap=btn.closest("div[data-state]"); wrap.setAttribute("data-state","open");
        if(region){ region.hidden=false; } if(ans){ ans.hidden=false; }
      }
    });
  });

  // ------- demo scenario tabs -------
  var LOG = window.__DEMOS__ || {};
  var log = $("#demo-log");
  $$('#demo [data-demo]').forEach(function(tab){
    tab.addEventListener("click", function(){
      var k = tab.getAttribute("data-demo");
      track("demo_scenario", { scenario: k });
      $$('#demo [data-demo]').forEach(function(t){
        var on = t===tab;
        t.setAttribute("aria-selected", on?"true":"false");
        t.classList.toggle("border-champagne/50", on);
        t.classList.toggle("bg-ink-foreground/[0.07]", on);
        t.classList.toggle("text-champagne", on);
        t.classList.toggle("border-ink-border", !on);
        t.classList.toggle("text-ink-muted", !on);
      });
      if(log && LOG[k]){
        log.style.opacity=0;
        setTimeout(function(){ log.innerHTML = LOG[k]; log.style.transition="opacity .3s"; log.style.opacity=1; }, reduce?0:120);
      }
    });
  });

  // ------- Calendly -------
  function openCal(e){ if(e)e.preventDefault();
    track("calendly_open", { surface: "popup" });
    if(window.Calendly){ Calendly.initPopupWidget({url: CAL + "?hide_gdpr_banner=1"}); }
    else { window.open(CAL, "_blank", "noopener"); } }
  $$('[data-calendly]').forEach(function(a){ a.addEventListener("click", openCal); });
  function inlineCal(){
    var host = $("#calendly-inline"); if(!host || host.dataset.done) return;
    host.dataset.done = "1";
    track("booking_widget_view");
    if(window.Calendly){ Calendly.initInlineWidget({ url: host.getAttribute("data-url"), parentElement: host }); }
    else { host.innerHTML = '<a class="flex h-full items-center justify-center text-champagne underline" target="_blank" rel="noopener" href="'+CAL+'">Open the scheduler &rarr;</a>'; }
  }

  // Load the scheduler when the booking panel gets close, not on first paint.
  (function(){
    var host = $("#calendly-inline"); if(!host) return;
    function start(){
      if(window.Calendly) return inlineCal();
      var t = setInterval(function(){ if(window.Calendly){ clearInterval(t); inlineCal(); } }, 120);
      setTimeout(function(){ clearInterval(t); inlineCal(); }, 6000);
    }
    var vio = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ vio.disconnect(); start(); } });
    }, {rootMargin:"400px 0px"});
    vio.observe(host);
  })();

  // A completed booking is the one conversion on this page.
  addEventListener("message", function(e){
    if(String(e.origin).indexOf("calendly.com") === -1) return;
    var d = e.data;
    if(d && d.event === "calendly.event_scheduled"){ track("booking_scheduled"); }
  });
})();


</script>
<script>window.__DEMOS__ = __DEMOS_JSON__;</script>
<div id="mobile-cta"><a href="#book">Book a discovery call</a></div>'''

# ---------------------------------------------------------------- 10. one CTA everywhere
# The site has a single objective: book a discovery call. Every CTA says so, and
# the "revenue leak audit" offer is gone. Note none of these patterns touch
# "audit log" in the safety section.
CTA = "Book a discovery call"
REBRAND = [
    # anchors / ids
    ('href="#audit"', 'href="#book"', 10),   # 9 in the SSR source + 1 in NAVPANEL
    ('id="audit"', 'id="book"', 1),
    # button + link labels
    ("Get a free revenue leak audit", CTA, 5),
    ("Book a revenue leak audit", CTA, 2),    # header nav + NAVPANEL
    (">Book a call</a>", ">" + CTA + "</a>", 1),
    ("Discuss your system", CTA, 1),
    ("Get a custom plan", CTA, 1),
    ("Discuss ongoing support", CTA, 1),
    # body copy that sold the audit
    ("The revenue leak audit", "The discovery call", 1),   # section label, not a CTA
    ("20-minute audit.", "20-minute call.", 1),
    ("The audit maps which of these five leaks",
     "A 20-minute discovery call maps which of these five leaks", 1),
    ("20-minute Revenue Leak Audit. We look at",
     "A 20-minute discovery call. We look at", 1),
    ("Scoped after audit", "Scoped after the call", 1),
    ("Typical projects start with an audit and are priced based on scope.",
     "Typical projects start with a discovery call and are priced based on scope.", 1),
]
for _old, _new, _n in REBRAND:
    _found = body.count(_old)
    assert _found == _n, "rebrand: expected %d of %r, found %d" % (_n, _old, _found)
    body = body.replace(_old, _new)

import json
app_js = APP_JS.replace("__DEMOS_JSON__", json.dumps(DEMOS))

SITE_URL = "https://www.micronsai.com"
html = ("<!doctype html>\n<html lang=\"en\">\n<head>\n"
        + HEAD.replace("__SITE__", SITE_URL)
        + "\n</head>\n<body>\n"
        + body
        + "\n" + app_js.replace("__SITE__", SITE_URL)
        + "\n</body>\n</html>\n")

for must in ['id="book"', 'id="book-panel"', 'id="results"', 'id="mobile-nav"', 'data-calendly',
             '/privacy.html', 'hero-flow', 'demo-log', 'calendly-inline', '__DEMOS__ = {',
             'id="trust"', 'id="safety"', 'MICRONS_ANALYTICS', 'booking_scheduled',
             'booking_widget_view', 'not a medical device', 'Book a discovery call']:
    assert must in html, "missing in output: " + must
assert "mailto:hello@microns.ai?subject" not in html, "old mailto CTA still present"
for gone in ['id="mform"', 'id="mdone"', 'mform-sink', 'MICRONS_CONFIG', 'formsubmit.co', 'name="crm"']:
    assert gone not in html, "removed feature still present: " + gone
# the only surviving "audit" on the page is the safety section's audit log
assert html.lower().count("audit") == html.lower().count("audit log"), \
    "stray 'audit' copy left on the page"
assert "index-IxsVMaXH.js" not in html and "lovable-badge" not in html, "leftover bundle refs"

(SITE / "index.html").write_text(html, encoding="utf-8")
print("wrote index.html:", len(html), "bytes")
print("checks: booking panel", 'id="book-panel"' in html, "| results", 'id="results"' in html,
      "| calendly", "calendly" in html, "| faq answers", html.count("faq-answer"),
      "| demo tabs", html.count('data-demo="'))
