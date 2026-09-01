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

# ---------------------------------------------------------------- 6 + 1. audit: form + Calendly
# left CTA: mailto -> Calendly popup + scroll helper
body = body.replace(
 '<a href="mailto:hello@microns.ai?subject=Revenue%20Leak%20Audit" class="group mt-9 inline-flex min-h-12 items-center gap-3 rounded-full bg-champagne px-7 text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-champagne-foreground shadow-editorial transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">Book your free audit',
 '<a href="#audit-form" data-calendly class="group mt-9 inline-flex min-h-12 items-center gap-3 rounded-full bg-champagne px-7 text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-champagne-foreground shadow-editorial transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">Pick a time now', 1)

AUDIT_FORM = '''<div id="audit-form" class="scroll-mt-24 rounded-2xl border border-ink-border bg-ink-foreground/[0.04] p-6 sm:p-8"><p class="eyebrow text-champagne">Request your audit</p><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">Tell us where inquiries come in. We reply within one business day \u2014 or book a time straight away.</p><form id="mform" class="mt-6 grid gap-4" novalidate><input type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true" class="hidden"><div class="grid gap-4 sm:grid-cols-2"><label class="mf"><span>Name</span><input name="name" autocomplete="name" required></label><label class="mf"><span>Med spa</span><input name="medspa" required></label></div><label class="mf"><span>Location (city, state)</span><input name="location" placeholder="Scottsdale, AZ" required></label><div class="grid gap-4 sm:grid-cols-2"><label class="mf"><span>Email</span><input type="email" name="email" autocomplete="email" required></label><label class="mf"><span>Phone</span><input type="tel" name="phone" autocomplete="tel"></label></div><label class="mf"><span>New leads / month</span><select name="monthly_leads"><option value="">Select\u2026</option><option>Under 50</option><option>50\u2013150</option><option>150\u2013400</option><option>400+</option><option>Not sure</option></select></label><label class="mf"><span>Biggest gap</span><select name="gap"><option value="">Select\u2026</option><option>Missed calls</option><option>Slow lead response</option><option>No-shows</option><option>Losing no-shows</option><option>Not enough reviews</option><option>Not sure yet</option></select></label><button type="submit" class="group mt-1 inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full bg-champagne px-7 text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-champagne-foreground shadow-editorial transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">Get my free audit<span aria-hidden="true" class="transition-transform duration-300 group-hover:translate-x-1">\u2192</span></button><p class="text-[0.75rem] leading-relaxed text-ink-muted">20 minutes \u00b7 no obligation \u00b7 no hard pitch. By submitting you agree to our <a class="underline hover:text-champagne" href="/privacy.html">Privacy Policy</a>.</p></form><div id="mdone" hidden><div class="flex items-center gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-full bg-champagne text-champagne-foreground"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><p class="font-display text-[1.0625rem] font-semibold text-ink-foreground">Request received.</p></div><p class="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">Pick a 20-minute slot now, or we&#x27;ll email you within one business day.</p><div id="calendly-inline" class="mt-5 overflow-hidden rounded-xl border border-ink-border" style="min-width:280px;height:640px" data-url="https://calendly.com/vedantpawar3690/30min?hide_gdpr_banner=1&background_color=1a1a1a&text_color=f5f3ef&primary_color=e8d5b5"></div></div><iframe name="mform-sink" title="form target" class="hidden" aria-hidden="true"></iframe></div>'''

# insert the form as a new right-hand column inside the audit grid, before the existing 3-step <ol> wrapper
_audit_anchor = '<div class="transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none reveal"><ol class="space-y-4"><li class="group flex gap-5 rounded-2xl border border-ink-border'
assert _audit_anchor in body, "audit anchor not found"
body = body.replace(
 _audit_anchor,
 '<div class="transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none reveal">' + AUDIT_FORM + '<p class="eyebrow text-champagne mt-10">What the 20 minutes covers</p><ol class="space-y-4 mt-4"><li class="group flex gap-5 rounded-2xl border border-ink-border',
 1)

# ---------------------------------------------------------------- 5 (nav). mobile menu panel
NAVPANEL = ('<div id="mobile-nav" class="md:hidden">'
 '<div class="flex flex-col">'
 '<a href="#how-it-works" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">How it works</a>'
 '<a href="#systems" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">Systems</a>'
 '<a href="#why-microns" class="border-b border-border py-4 font-display text-[0.9375rem] font-medium">Why Microns</a>'
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
</style>'''

APP_JS = '''<script src="https://assets.calendly.com/assets/external/widget.js" defer></script>
<script>
(function(){
  "use strict";
  // ------- config: fill in once you share the Google Form -------
  window.MICRONS_CONFIG = Object.assign({
    // Leads are emailed here via FormSubmit (https://formsubmit.co). The FIRST submission
    // sends a one-time activation link to this address - click it once, then leads flow.
    formEndpoint: "https://formsubmit.co/ajax/ved@micronsai.com",
    // Optional: also mirror submissions into a Google Form (fill action + entry IDs).
    googleFormAction: "",
    entries: { name:"", medspa:"", location:"", email:"", phone:"", monthly_leads:"", gap:"" }
  }, window.MICRONS_CONFIG || {});
  var CAL = "https://calendly.com/vedantpawar3690/30min";
  var $=function(s,c){return (c||document).querySelector(s)};
  var $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
  var reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;

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
    if(window.Calendly){ Calendly.initPopupWidget({url: CAL + "?hide_gdpr_banner=1"}); }
    else { window.open(CAL, "_blank", "noopener"); } }
  $$('[data-calendly]').forEach(function(a){ a.addEventListener("click", openCal); });
  function inlineCal(){
    var host = $("#calendly-inline"); if(!host || host.dataset.done) return;
    host.dataset.done = "1";
    if(window.Calendly){ Calendly.initInlineWidget({ url: host.getAttribute("data-url"), parentElement: host }); }
    else { host.innerHTML = '<a class="flex h-full items-center justify-center text-champagne underline" target="_blank" rel="noopener" href="'+CAL+'">Open the scheduler &rarr;</a>'; }
  }

  // ------- audit form -------
  var form = $("#mform");
  if(form){
    form.addEventListener("submit", function(e){
      e.preventDefault();
      if(form.querySelector('[name="company"]').value){ return; } // honeypot
      if(!form.checkValidity()){ form.reportValidity(); return; }
      var cfg = window.MICRONS_CONFIG, data = {};
      $$("input,select", form).forEach(function(f){ if(f.name && f.name!=="company") data[f.name]=f.value; });
      var btn = form.querySelector('button[type="submit"]'); if(btn){ btn.disabled = true; btn.style.opacity = .6; }

      function finish(){
        form.hidden = true;
        var done = $("#mdone");
        if(done){ done.hidden = false; inlineCal(); done.scrollIntoView({behavior:reduce?"auto":"smooth",block:"nearest"}); }
      }
      // local backup (survives any network failure)
      try{ var box=JSON.parse(localStorage.getItem("microns_leads")||"[]"); box.push(Object.assign({t:Date.now()},data)); localStorage.setItem("microns_leads",JSON.stringify(box)); }catch(_){}

      // optional Google Form mirror
      if(cfg.googleFormAction && cfg.entries && cfg.entries.name){
        var gf=document.createElement("form"); gf.action=cfg.googleFormAction; gf.method="POST"; gf.target="mform-sink"; gf.style.display="none";
        Object.keys(cfg.entries).forEach(function(k){ if(!cfg.entries[k]) return;
          var i=document.createElement("input"); i.type="hidden"; i.name=cfg.entries[k]; i.value=data[k]||""; gf.appendChild(i); });
        document.body.appendChild(gf); gf.submit(); setTimeout(function(){ gf.remove(); }, 1000);
      }

      // primary: email the lead via FormSubmit
      if(cfg.formEndpoint){
        var payload = Object.assign({
          _subject: "New revenue leak audit request — " + (data.medspa || data.name || ""),
          _template: "table", _captcha: "false"
        }, data);
        fetch(cfg.formEndpoint, {
          method:"POST", headers:{ "Content-Type":"application/json", "Accept":"application/json" },
          body: JSON.stringify(payload)
        }).then(function(r){ return r.json().catch(function(){ return {}; }); })
          .then(function(){ finish(); })
          .catch(function(){ finish(); });
      } else {
        finish();
      }
    });
  }
})();
</script>
<script>window.__DEMOS__ = __DEMOS_JSON__;</script>
<div id="mobile-cta"><a href="#audit-form">Get a free audit</a></div>'''

import json
app_js = APP_JS.replace("__DEMOS_JSON__", json.dumps(DEMOS))

SITE_URL = "https://www.micronsai.com"
html = ("<!doctype html>\n<html lang=\"en\">\n<head>\n"
        + HEAD.replace("__SITE__", SITE_URL)
        + "\n</head>\n<body>\n"
        + body
        + "\n" + app_js.replace("__SITE__", SITE_URL)
        + "\n</body>\n</html>\n")

for must in ['id="mform"', 'id="results"', 'id="mobile-nav"', 'data-calendly', '/privacy.html',
             'hero-flow', 'demo-log', 'calendly-inline', 'Pick a time now', '__DEMOS__ = {']:
    assert must in html, "missing in output: " + must
assert "mailto:hello@microns.ai?subject" not in html, "old mailto CTA still present"
assert "index-IxsVMaXH.js" not in html and "lovable-badge" not in html, "leftover bundle refs"

(SITE / "index.html").write_text(html, encoding="utf-8")
print("wrote index.html:", len(html), "bytes")
print("checks: form", "id=\"mform\"" in html, "| results", 'id="results"' in html,
      "| calendly", "calendly" in html, "| faq answers", html.count("faq-answer"),
      "| demo tabs", html.count('data-demo="'))
