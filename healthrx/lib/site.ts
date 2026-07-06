// Central config + content for HealthRx Fitness Club.
// Editing copy, pricing, or contact details here updates the whole site.

export const site = {
  name: "HealthRx Fitness Club",
  short: "HealthRx",
  tagline: "We Prescribe Health",
  city: "Nashik",
  description:
    "HealthRx Fitness Club is Nashik's premium, science-driven medical fitness club. Personal training, transformation coaching, and evidence-based programming. We Prescribe Health.",
  phone: "+91 90000 00000",
  whatsapp: "919000000000", // digits only for wa.me link
  email: "hello@healthrx.fit",
  address: "College Road, Nashik, Maharashtra 422005, India",
  mapsEmbed:
    "https://www.google.com/maps?q=College+Road,+Nashik,+Maharashtra&output=embed",
  mapsLink: "https://www.google.com/maps?q=College+Road,+Nashik,+Maharashtra",
  hours: "Mon–Sun · 5:00 AM – 11:00 PM",
  socials: {
    instagram: "https://instagram.com",
    youtube: "https://youtube.com",
    facebook: "https://facebook.com",
  },
} as const;

export const nav = [
  { label: "Services", href: "#services" },
  { label: "Philosophy", href: "#philosophy" },
  { label: "Space", href: "#gallery" },
  { label: "Trainers", href: "#trainers" },
  { label: "Plans", href: "#plans" },
  { label: "Calculators", href: "#calculators" },
  { label: "Contact", href: "#contact" },
] as const;

export const stats = [
  { value: 2400, suffix: "+", label: "Members transformed" },
  { value: 18, suffix: "", label: "Certified specialists" },
  { value: 96, suffix: "%", label: "Goal completion rate" },
  { value: 9, suffix: " yrs", label: "In medical fitness" },
];

// Real photography of the HealthRx / SyncRx space.
// Drop the image files into `public/gallery/` using the `src` names below and
// they appear automatically. Until then, a branded placeholder is shown.
export const gallery = [
  {
    src: "/gallery/exterior.jpg",
    title: "The Building",
    tag: "Exterior",
    span: "wide",
  },
  {
    src: "/gallery/reception.jpg",
    title: "Reception & Lounge",
    tag: "Arrival",
    span: "tall",
  },
  {
    src: "/gallery/arrival.jpg",
    title: "The Archway",
    tag: "Entrance",
    span: "normal",
  },
  {
    src: "/gallery/floor.jpg",
    title: "Strength Floor",
    tag: "Training",
    span: "normal",
  },
  {
    src: "/gallery/studio.jpg",
    title: "SyncRx Studio",
    tag: "Yoga & Recovery",
    span: "wide",
  },
] as const;

export const services = [
  {
    icon: "heart",
    title: "Medical Fitness Screening",
    body: "Pre-exercise health assessments, movement screens and biomarkers so every program starts from data — not guesswork.",
  },
  {
    icon: "dumbbell",
    title: "1:1 Personal Training",
    body: "Certified coaches build progressive strength plans around your body, schedule and injury history.",
  },
  {
    icon: "flame",
    title: "Fat Loss & Transformation",
    body: "Structured 12–24 week protocols pairing training, nutrition and accountability for lasting change.",
  },
  {
    icon: "leaf",
    title: "Clinical Nutrition Coaching",
    body: "Registered nutrition guidance with macro targets tuned to your labs, lifestyle and goals.",
  },
  {
    icon: "woman",
    title: "Women's Strength Studio",
    body: "A dedicated, judgement-free space with programming for strength, hormones and confidence.",
  },
  {
    icon: "pulse",
    title: "Rehab & Mobility",
    body: "Post-injury reconditioning and mobility work supervised by movement specialists.",
  },
];

export const philosophy = [
  {
    step: "01",
    title: "Assess",
    body: "We measure before we prescribe — body composition, mobility, resting heart rate and lifestyle load.",
  },
  {
    step: "02",
    title: "Prescribe",
    body: "A precise, periodised training and nutrition plan — dosed like medicine, adjusted like therapy.",
  },
  {
    step: "03",
    title: "Progress",
    body: "Weekly check-ins and re-testing keep the plan honest and your results compounding.",
  },
];

export const trainers = [
  {
    name: "Dr. Aditi Kulkarni",
    role: "Head of Medical Fitness",
    creds: "PhD Sports Science · CSCS",
    focus: "Metabolic health · Rehab",
    initials: "AK",
  },
  {
    name: "Rohan Deshmukh",
    role: "Strength & Conditioning Lead",
    creds: "MSc S&C · IPF Coach",
    focus: "Powerlifting · Hypertrophy",
    initials: "RD",
  },
  {
    name: "Sara Fernandes",
    role: "Women's Programming Coach",
    creds: "Pre/Postnatal · Kettlebell L2",
    focus: "Women's strength · Mobility",
    initials: "SF",
  },
  {
    name: "Imran Sheikh",
    role: "Transformation Specialist",
    creds: "Precision Nutrition L2",
    focus: "Fat loss · Accountability",
    initials: "IS",
  },
];

export const plans = [
  {
    name: "Foundation",
    price: "₹2,999",
    period: "/mo",
    tagline: "Start with structure",
    features: [
      "Full club & equipment access",
      "Health & movement screening",
      "Group strength classes",
      "Nutrition starter guide",
      "Progress app access",
    ],
    featured: false,
  },
  {
    name: "Prescription",
    price: "₹6,499",
    period: "/mo",
    tagline: "Our signature program",
    features: [
      "Everything in Foundation",
      "8 × 1:1 personal training / mo",
      "Custom macro & meal plan",
      "Bi-weekly re-testing",
      "Priority booking & recovery zone",
    ],
    featured: true,
  },
  {
    name: "Elite Clinical",
    price: "₹12,999",
    period: "/mo",
    tagline: "Fully managed transformation",
    features: [
      "Everything in Prescription",
      "Unlimited 1:1 coaching",
      "Dedicated medical fitness lead",
      "Quarterly lab-based review",
      "24/7 coach messaging",
    ],
    featured: false,
  },
];

export const transformations = [
  {
    name: "Priya, 34",
    result: "-14 kg in 20 weeks",
    before: "#3a2f2a",
    after: "#1f2d1a",
  },
  {
    name: "Aman, 41",
    result: "+9 kg lean mass",
    before: "#2a2f3a",
    after: "#1a2620",
  },
  {
    name: "Neha, 29",
    result: "Post-partum strength rebuild",
    before: "#332a33",
    after: "#1c2a1f",
  },
];

export const testimonials = [
  {
    quote:
      "For the first time a gym actually measured my health before handing me a plan. Down 12kg and my blood work has never looked better.",
    name: "Sneha P.",
    role: "Marketing Lead · Member 1yr",
  },
  {
    quote:
      "The coaching feels clinical in the best way — everything is tracked, adjusted and explained. It's the reason I finally stuck with it.",
    name: "Vikram J.",
    role: "Entrepreneur · Member 2yr",
  },
  {
    quote:
      "As a beginner I was intimidated. HealthRx made it feel like therapy for my body. The women's studio changed everything.",
    name: "Aarti M.",
    role: "Doctor · Member 8mo",
  },
  {
    quote:
      "Rehab after my knee surgery was slow until I came here. Supervised, safe, and genuinely evidence-based.",
    name: "Karan D.",
    role: "Architect · Member 1yr",
  },
];

export const faqs = [
  {
    q: "I'm a complete beginner — is HealthRx right for me?",
    a: "Absolutely. Most of our members start as beginners. Every journey begins with a health and movement screening so your plan is dosed to your current level and progressed safely.",
  },
  {
    q: "What makes a 'medical fitness' club different?",
    a: "We assess before we prescribe. Programs are built from real data — body composition, mobility, resting heart rate and lifestyle — and re-tested regularly, the way a clinician would adjust a treatment.",
  },
  {
    q: "Do you offer women-only training spaces?",
    a: "Yes. Our Women's Strength Studio is a dedicated, private space with coaches specialised in women's strength, hormonal and pre/postnatal programming.",
  },
  {
    q: "Can you help with a specific medical condition or injury?",
    a: "Our rehab and mobility specialists work with post-injury and managed conditions. We coordinate around your physician's guidance — please share any medical clearance during screening.",
  },
  {
    q: "How do the personal training sessions work?",
    a: "1:1 sessions are booked through the member app around your schedule. Prescription and Elite plans include a set number of sessions each month with your matched coach.",
  },
  {
    q: "Is there a lock-in contract?",
    a: "No long lock-ins. Memberships are monthly. Transformation programs run in structured 12–24 week blocks so results have time to compound.",
  },
];

export const posts = [
  {
    title: "Why we screen before we sweat",
    excerpt:
      "The case for pre-exercise assessment — and how it prevents injury while accelerating results.",
    tag: "Medical Fitness",
    read: "6 min",
  },
  {
    title: "Protein, simplified for real life",
    excerpt:
      "How much protein you actually need in Nashik's climate, and easy ways to hit your target.",
    tag: "Nutrition",
    read: "5 min",
  },
  {
    title: "Strength training for women, decoded",
    excerpt:
      "Debunking the 'bulky' myth and building a plan around strength, bone health and confidence.",
    tag: "Women's Health",
    read: "7 min",
  },
];
