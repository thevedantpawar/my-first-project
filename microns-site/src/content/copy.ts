/**
 * Copy deck. Section 5 of the brief is the source of truth; the operational
 * detail attached to each system is taken from the workflows that actually
 * run, not invented for the page.
 */

export const problems = [
  {
    claim: "A missed call is a missed consult.",
    body: "Most enquiries come by phone, and most go unanswered outside clinic hours. The caller books with whoever picks up next.",
  },
  {
    claim: "A cold lead is a dead lead.",
    body: "Someone who fills in your form at 9pm and hears back at 11am the next day has already been messaged by two competitors.",
  },
  {
    claim: "A no-show is an empty chair you already paid for.",
    body: "The room, the staff and the slot are booked whether the client walks in or not.",
  },
] as const;

/**
 * The visual beside each system: a depiction of what the client on the other
 * end actually receives. Every one is captioned as an illustration on the page.
 */
export type SystemVisual = {
  channel: string;
  stamp: string;
  /** Messages, in order. "out" is from the clinic, "in" is the client. */
  thread: { from: "out" | "in"; text: string }[];
  outcome?: string;
};

export type System = {
  n: string;
  slug: string;
  name: string;
  short: string;
  trigger: string;
  timing: string;
  /** Interior page detail. */
  does: string;
  experience: string;
  connects: string;
  visual: SystemVisual;
};

export const systems: System[] = [
  {
    n: "01",
    slug: "speed-to-lead-reply",
    name: "Speed-to-lead reply",
    short:
      "Every new enquiry gets a personal, on-brand reply within 60 seconds, day or night, and gets qualified before it reaches your team.",
    trigger: "A new enquiry arrives",
    timing: "Within 60 seconds",
    does: "Answers every new enquiry immediately, in your voice, and asks the questions your team would have asked anyway.",
    experience:
      "They get a reply while they are still on your website, not the next morning. It reads like the clinic wrote it, because you wrote it.",
    connects:
      "Your website form, your chat widget, your inbound SMS number and your email inbox.",
    visual: {
      channel: "Text message",
      stamp: "21:47:38 — 38 seconds after the form",
      thread: [
        {
          from: "out",
          text: "Hi Jenna — thanks for enquiring about lip filler. I can hold a consult on Thursday at 2pm or Friday at 10am. Which suits you better?",
        },
        { from: "in", text: "Thursday please" },
      ],
      outcome: "Consult booked before the clinic opened.",
    },
  },
  {
    n: "02",
    slug: "no-show-prevention",
    name: "No-show prevention",
    short:
      "Layered reminders across text and email, timed to when clients actually cancel, with a one-tap reschedule instead of a silent drop.",
    trigger: "An appointment is coming up",
    timing: "24 hours and 2 hours before",
    does: "Sends reminders at the two points where cancellations cluster, and makes moving the appointment easier than abandoning it.",
    experience:
      "A text they can act on with one tap. If Thursday no longer works, they move it instead of quietly not turning up.",
    connects: "Your booking software and your SMS number.",
    visual: {
      channel: "Text message",
      stamp: "24 hours before the appointment",
      thread: [
        {
          from: "out",
          text: "Reminder: your appointment is tomorrow at 14:00 with Amelia. Reply C to confirm, or tap here to move it — no charge.",
        },
        { from: "in", text: "C" },
      ],
      outcome: "Confirmed. A second reminder goes out two hours before.",
    },
  },
  {
    n: "03",
    slug: "no-show-recovery",
    name: "No-show recovery",
    short:
      "When someone doesn't turn up, they get a real follow-up the same day and an offer to rebook, instead of disappearing from your calendar forever.",
    trigger: "An appointment is marked as a no-show",
    timing: "Same day, then again three days later",
    does: "Follows up the same day with a booking link, and comes back once more with a reason to return before the client goes cold.",
    experience:
      "A message that reads like someone noticed, not like a receipt. Most people who miss an appointment are embarrassed, not gone.",
    connects: "Your booking software and your SMS number.",
    visual: {
      channel: "Text message",
      stamp: "Same day, 16:20",
      thread: [
        {
          from: "out",
          text: "We missed you this afternoon, Sofia — no problem at all. Here are this week's open slots if you'd like to pick another time.",
        },
      ],
      outcome: "A second message follows three days later if there is no reply.",
    },
  },
  {
    n: "04",
    slug: "review-requests",
    name: "Review requests",
    short:
      "Every happy client gets asked at the right moment, routed to your Google profile. Unhappy ones get routed to you first.",
    trigger: "An appointment is completed",
    timing: "Five days after the visit",
    does: "Asks at the point where the result has settled and the client is happiest, then routes the answer: public if it is good, straight to you if it is not.",
    experience:
      "One short message asking how it went. Two taps to leave a review if they want to.",
    connects: "Your booking software and your Google Business Profile.",
    visual: {
      channel: "Text message",
      stamp: "Five days after the visit",
      thread: [
        { from: "out", text: "Hi Priya — how has your treatment settled in?" },
        { from: "in", text: "Really happy with it" },
        {
          from: "out",
          text: "That's great to hear. Would you mind leaving that in a quick Google review? It takes about 30 seconds.",
        },
      ],
      outcome: "Anything less than happy is routed to the clinic instead.",
    },
  },
  {
    n: "05",
    slug: "front-desk-handoff",
    name: "Front desk handoff",
    short:
      "Calls that come in after hours are answered, triaged and passed to your team as a written summary the next morning.",
    trigger: "A call arrives outside opening hours",
    timing: "Summary waiting the next morning",
    does: "Picks up, finds out what the caller needs, books it if it is bookable, and flags anything clinical for a human instead of guessing.",
    experience:
      "Someone answers at 9pm. They get an answer to a simple question or a slot held, and never a clinical opinion from a machine.",
    connects: "Your phone number, your booking software and your team's inbox.",
    visual: {
      channel: "Morning summary",
      stamp: "08:00 — to the team inbox",
      thread: [
        {
          from: "out",
          text: "Three calls after close. One booked a consult for Tuesday. One asked about pricing and wants a callback before noon. One asked about swelling after filler — flagged for a practitioner, not answered.",
        },
      ],
      outcome: "Nothing clinical is ever answered by the system.",
    },
  },
];

export const steps = [
  {
    n: "1",
    name: "Audit",
    body: "A 20-minute call and a look at your booking data. We find where the money is leaking and tell you which of the five is worth doing first. Free, and useful even if you never hire us.",
  },
  {
    n: "2",
    name: "Build",
    body: "We build and connect the system to your existing tools. Typically two weeks. You review every message before it goes to a real client.",
  },
  {
    n: "3",
    name: "Run",
    body: "It runs. We monitor it, fix it and adjust the copy as your offers change. You get a monthly note on what it recovered.",
  },
] as const;

/** Section 5.7, option B: the audit itself is the proof. */
export const auditChecks = [
  {
    label: "Missed call volume",
    body: "How many calls go unanswered in a week, and what share of them arrive after you close.",
  },
  {
    label: "Response time to web enquiries",
    body: "The gap between a form being filled in and a human replying, measured across the last 30 days.",
  },
  {
    label: "No-show rate by day of week",
    body: "Which days lose the most chairs, and whether the pattern is the day, the treatment or the reminder.",
  },
  {
    label: "Review velocity",
    body: "How many reviews you get a month, against how many clients were actually asked.",
  },
  {
    label: "Where enquiries arrive",
    body: "Phone, form, Instagram, walk-in — and which of those routes has nobody watching it.",
  },
] as const;

export const faqs = [
  {
    q: "Will my clients know it's automated?",
    a: "They'll know they got a fast, correctly-worded reply. Every message is written in your voice and reviewed by you before it goes live. Nothing goes out that you haven't read.",
  },
  {
    q: "Does this replace my front desk?",
    a: "No. It covers the hours and the volume they can't — after close, during treatments, and the fifth call while they're on the fourth.",
  },
  {
    q: "Do I have to change my booking software?",
    a: "No. We build around what you already use.",
  },
  {
    q: "How long until it's running?",
    a: "Usually two weeks from the kickoff call.",
  },
  {
    q: "What if it breaks?",
    a: "It's monitored. If something fails, we know before you do, and fixing it is included.",
  },
  {
    q: "Who actually builds it?",
    a: "The people who scoped it. You talk to the team doing the work, not to an account manager relaying it. Nothing gets lost between the person who sold it and the person who writes it.",
  },
] as const;
