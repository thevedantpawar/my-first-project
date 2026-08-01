/**
 * Seed data for Ashirwad Wellness.
 *
 * Every product below is a real product sold in Indian retail pharmacy, with
 * its actual composition, manufacturer, dosage form and a realistic MRP. That
 * matters: an Rx gate seeded with placeholder data is an Rx gate nobody has
 * actually tested. The Schedule H and H1 entries in particular are genuine
 * Rule 65(11A) items, so the pharmacist queue has real work to do.
 *
 * Copy for nutraceutical, cosmetic and ayurvedic products is written to pass
 * the therapeutic-claim linter — no "cures", "treats", "prevents", and no
 * disease names. That constraint is the point, not an inconvenience.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  DosageForm,
  ScheduleType,
  Role,
  BannedReason,
} from "../src/generated/prisma/enums";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** ₹ to paise. Seed data is written in rupees for readability. */
const rs = (rupees: number) => Math.round(rupees * 100);

/**
 * Normalised salt fingerprint used for substitute lookup. Sorted so that
 * "A+B" and "B+A" produce the same key.
 */
const saltKeyOf = (salts: { name: string; strength: string }[]) =>
  salts
    .map((s) => `${slugify(s.name)}:${s.strength.toLowerCase().replace(/\s+/g, "")}`)
    .sort()
    .join("|");

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const CATEGORIES: {
  name: string;
  slug: string;
  children?: { name: string; slug: string }[];
}[] = [
  {
    name: "Medicines",
    slug: "medicines",
    children: [
      { name: "Pain Relief & Fever", slug: "pain-relief-fever" },
      { name: "Antibiotics", slug: "antibiotics" },
      { name: "Diabetes Care", slug: "diabetes-care" },
      { name: "Heart & Blood Pressure", slug: "heart-blood-pressure" },
      { name: "Stomach & Digestion", slug: "stomach-digestion" },
      { name: "Cold, Cough & Allergy", slug: "cold-cough-allergy" },
    ],
  },
  {
    name: "Vitamins & Supplements",
    slug: "vitamins-supplements",
    children: [
      { name: "Multivitamins", slug: "multivitamins" },
      { name: "Minerals", slug: "minerals" },
      { name: "Protein & Nutrition", slug: "protein-nutrition" },
    ],
  },
  {
    name: "Skin Care",
    slug: "skin-care",
    children: [
      { name: "Cleansers & Moisturisers", slug: "cleansers-moisturisers" },
      { name: "Sun Care", slug: "sun-care" },
    ],
  },
  {
    name: "Ayurveda",
    slug: "ayurveda",
    children: [
      { name: "Classical Formulations", slug: "classical-formulations" },
      { name: "Herbal Supplements", slug: "herbal-supplements" },
    ],
  },
  {
    name: "Devices & Diagnostics",
    slug: "devices-diagnostics",
    children: [
      { name: "Monitoring Devices", slug: "monitoring-devices" },
      { name: "Test Strips & Consumables", slug: "test-strips-consumables" },
    ],
  },
  {
    name: "Baby Care",
    slug: "baby-care",
    children: [
      { name: "Baby Bath & Skin", slug: "baby-bath-skin" },
      { name: "Diapers & Wipes", slug: "diapers-wipes" },
    ],
  },
  {
    name: "Personal Care",
    slug: "personal-care",
    children: [
      { name: "Oral Care", slug: "oral-care" },
      { name: "Antiseptics & First Aid", slug: "antiseptics-first-aid" },
    ],
  },
];

const MANUFACTURERS = [
  "GlaxoSmithKline Pharmaceuticals Ltd",
  "Micro Labs Ltd",
  "Sanofi India Ltd",
  "Reckitt Benckiser (India) Pvt Ltd",
  "Sun Pharmaceutical Industries Ltd",
  "Alembic Pharmaceuticals Ltd",
  "Cipla Ltd",
  "FDC Ltd",
  "Mankind Pharma Ltd",
  "Aristo Pharmaceuticals Pvt Ltd",
  "Lupin Ltd",
  "USV Pvt Ltd",
  "Glenmark Pharmaceuticals Ltd",
  "Alkem Laboratories Ltd",
  "Dr Reddy's Laboratories Ltd",
  "Abbott India Ltd",
  "Torrent Pharmaceuticals Ltd",
  "Apex Laboratories Pvt Ltd",
  "Merck Ltd",
  "Bayer Pharmaceuticals Pvt Ltd",
  "Dabur India Ltd",
  "Himalaya Wellness Company",
  "Emami Ltd",
  "Galderma India Pvt Ltd",
  "Hindustan Unilever Ltd",
  "Omron Healthcare India Pvt Ltd",
  "Roche Diabetes Care India Pvt Ltd",
  "Morepen Laboratories Ltd",
  "Romsons Scientific & Surgical Pvt Ltd",
  "Sebapharma GmbH & Co KG",
  "Procter & Gamble Hygiene and Health Care Ltd",
  "Ajanta Pharma Ltd",
  "JB Chemicals & Pharmaceuticals Ltd",
  "Centaur Pharmaceuticals Pvt Ltd",
  "Haleon India",
  "Danone Nutricia India Pvt Ltd",
  "MSD Pharmaceuticals Pvt Ltd",
  "Shree Baidyanath Ayurved Bhawan Pvt Ltd",
  "Novartis India Ltd",
  "Zydus Wellness Ltd",
  "Ipca Laboratories Ltd",
  "Franco-Indian Pharmaceuticals Pvt Ltd",
];

/**
 * Substances that must never appear in the catalogue. The database trigger
 * matches product name and composition against these.
 *
 * Note what is here: the habit-forming members of the Schedule H1 list
 * (alprazolam, diazepam, codeine, tramadol, pentazocine…). H1 status alone
 * does not make a drug listable — the anti-infective H1 items below are, the
 * psychotropic ones are not.
 */
const BANNED_SUBSTANCES: {
  name: string;
  reason: BannedReason;
  authority: string;
}[] = [
  { name: "alprazolam", reason: BannedReason.PSYCHOTROPIC, authority: "NDPS Act 1985; Schedule H1" },
  { name: "diazepam", reason: BannedReason.PSYCHOTROPIC, authority: "NDPS Act 1985; Schedule H1" },
  { name: "chlordiazepoxide", reason: BannedReason.PSYCHOTROPIC, authority: "NDPS Act 1985; Schedule H1" },
  { name: "nitrazepam", reason: BannedReason.PSYCHOTROPIC, authority: "NDPS Act 1985; Schedule H1" },
  { name: "midazolam", reason: BannedReason.PSYCHOTROPIC, authority: "NDPS Act 1985; Schedule H1" },
  { name: "zolpidem", reason: BannedReason.HABIT_FORMING, authority: "Schedule H1" },
  { name: "codeine", reason: BannedReason.NARCOTIC, authority: "NDPS Act 1985; Schedule H1" },
  { name: "tramadol", reason: BannedReason.NARCOTIC, authority: "NDPS Act 1985; Schedule H1" },
  { name: "pentazocine", reason: BannedReason.SCHEDULE_X, authority: "Schedule X, Drugs and Cosmetics Rules 1945" },
  { name: "buprenorphine", reason: BannedReason.SCHEDULE_X, authority: "Schedule X, Drugs and Cosmetics Rules 1945" },
  { name: "morphine", reason: BannedReason.NARCOTIC, authority: "NDPS Act 1985" },
  { name: "fentanyl", reason: BannedReason.NARCOTIC, authority: "NDPS Act 1985" },
  { name: "ketamine", reason: BannedReason.PSYCHOTROPIC, authority: "NDPS Act 1985; Schedule X" },
  { name: "amphetamine", reason: BannedReason.PSYCHOTROPIC, authority: "NDPS Act 1985" },
  { name: "methylphenidate", reason: BannedReason.PSYCHOTROPIC, authority: "Schedule X" },
  { name: "phenobarbitone", reason: BannedReason.HABIT_FORMING, authority: "Schedule X" },
  { name: "nimesulide + paracetamol", reason: BannedReason.BANNED_FDC, authority: "CDSCO banned fixed-dose combination" },
];

/** Nashik district — dispensing is tied to the licensed premises. */
const PINCODES: { pincode: string; city: string; codAvailable?: boolean; etaHours?: number }[] = [
  { pincode: "422001", city: "Nashik", etaHours: 12 },
  { pincode: "422002", city: "Nashik", etaHours: 12 },
  { pincode: "422003", city: "Nashik", etaHours: 12 },
  { pincode: "422004", city: "Nashik", etaHours: 12 },
  { pincode: "422005", city: "Nashik", etaHours: 24 },
  { pincode: "422006", city: "Nashik", etaHours: 24 },
  { pincode: "422007", city: "Nashik", etaHours: 24 },
  { pincode: "422008", city: "Nashik", etaHours: 24 },
  { pincode: "422009", city: "Nashik", etaHours: 24 },
  { pincode: "422010", city: "Nashik", etaHours: 24 },
  { pincode: "422011", city: "Nashik", etaHours: 24 },
  { pincode: "422013", city: "Nashik", etaHours: 24 },
  { pincode: "422101", city: "Nashik Road", etaHours: 36 },
  { pincode: "422103", city: "Sinnar", etaHours: 48, codAvailable: false },
  { pincode: "422206", city: "Ozar", etaHours: 48, codAvailable: false },
  { pincode: "422401", city: "Deolali", etaHours: 36 },
];

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

type SeedProduct = {
  name: string;
  brand: string;
  category: string;
  manufacturer: string;
  scheduleType: ScheduleType;
  composition: string;
  strength?: string;
  form: DosageForm;
  packSize: string;
  hsn: string;
  gst: number;
  mrp: number;
  sp: number;
  stock: number;
  salts?: { name: string; strength: string }[];
  nameHi?: string;
  refrigerated?: boolean;
  shortDescription?: string;
  uses?: string;
  howItWorks?: string;
  sideEffects?: string;
  storage?: string;
  warnings?: string;
  directions?: string;
};

const STORE_COOL = "Store below 25°C in a dry place, away from direct sunlight. Keep out of reach of children.";
const STORE_COLD = "Store between 2°C and 8°C. Do not freeze. Cold-chain delivery only.";

const PRODUCTS: SeedProduct[] = [
  // --- Pain relief & fever (OTC) -------------------------------------------
  {
    name: "Crocin Advance 500mg Tablet", brand: "Crocin", category: "pain-relief-fever",
    manufacturer: "GlaxoSmithKline Pharmaceuticals Ltd", scheduleType: ScheduleType.OTC,
    composition: "Paracetamol 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 31, sp: 27.9, stock: 240,
    salts: [{ name: "Paracetamol", strength: "500 mg" }], nameHi: "क्रोसिन एडवांस",
    shortDescription: "Fast-release paracetamol for fever and everyday pain.",
    uses: "Reduces fever and relieves mild to moderate pain including headache, toothache, body ache and period pain.",
    howItWorks: "Paracetamol blocks the production of prostaglandins in the brain, raising the pain threshold and helping the body lower its temperature set point.",
    sideEffects: "Generally well tolerated at recommended doses. Rarely: rash, nausea, liver enzyme changes.",
    warnings: "Do not exceed 4 g of paracetamol in 24 hours from all sources. Overdose causes serious liver injury. Avoid with regular alcohol use.",
    directions: "One tablet every 4 to 6 hours as needed, with or after food. Maximum 8 tablets in 24 hours.",
  },
  {
    name: "Dolo 650mg Tablet", brand: "Dolo", category: "pain-relief-fever",
    manufacturer: "Micro Labs Ltd", scheduleType: ScheduleType.OTC,
    composition: "Paracetamol 650mg", strength: "650 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 34.5, sp: 30.5, stock: 310,
    salts: [{ name: "Paracetamol", strength: "650 mg" }],
    shortDescription: "Higher-strength paracetamol for fever.",
    uses: "Reduces fever and relieves mild to moderate pain.",
    howItWorks: "Paracetamol acts centrally to raise the pain threshold and reset the hypothalamic temperature control.",
    sideEffects: "Uncommon at recommended doses. Rarely rash or nausea.",
    warnings: "Do not exceed 4 g of paracetamol in 24 hours from all sources.",
    directions: "One tablet every 6 to 8 hours after food, or as directed.",
  },
  {
    name: "Combiflam Tablet", brand: "Combiflam", category: "pain-relief-fever",
    manufacturer: "Sanofi India Ltd", scheduleType: ScheduleType.OTC,
    composition: "Ibuprofen 400mg + Paracetamol 325mg", strength: "400 mg + 325 mg",
    form: DosageForm.TABLET, packSize: "strip of 20 tablets", hsn: "30049099", gst: 1200,
    mrp: 54, sp: 47.5, stock: 180,
    salts: [{ name: "Ibuprofen", strength: "400 mg" }, { name: "Paracetamol", strength: "325 mg" }],
    shortDescription: "Combination analgesic for pain with inflammation.",
    uses: "Relieves pain associated with inflammation — dental pain, muscular pain, joint pain and period pain.",
    howItWorks: "Ibuprofen reduces prostaglandin production at the site of inflammation; paracetamol adds a central analgesic effect.",
    sideEffects: "Stomach upset, heartburn, nausea. Long-term use may affect the stomach lining and kidneys.",
    warnings: "Take after food. Avoid with a history of stomach ulcer, kidney impairment or asthma triggered by painkillers.",
    directions: "One tablet up to three times a day after food, for the shortest period necessary.",
  },
  {
    name: "Disprin Regular Tablet", brand: "Disprin", category: "pain-relief-fever",
    manufacturer: "Reckitt Benckiser (India) Pvt Ltd", scheduleType: ScheduleType.OTC,
    composition: "Aspirin 325mg", strength: "325 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30049099", gst: 1200, mrp: 12, sp: 11, stock: 200,
    salts: [{ name: "Aspirin", strength: "325 mg" }],
    shortDescription: "Dispersible aspirin for headache and body ache.",
    uses: "Relieves headache, toothache and body ache, and reduces fever.",
    howItWorks: "Aspirin irreversibly inhibits cyclo-oxygenase, reducing prostaglandins that signal pain and fever.",
    sideEffects: "Stomach irritation, nausea, increased bleeding tendency.",
    warnings: "Not for children under 16 years. Avoid with active stomach ulcer or bleeding disorders.",
    directions: "Dissolve one to two tablets in water, after food, up to three times daily.",
  },
  {
    name: "Volini Pain Relief Gel", brand: "Volini", category: "pain-relief-fever",
    manufacturer: "Sun Pharmaceutical Industries Ltd", scheduleType: ScheduleType.OTC,
    composition: "Diclofenac Diethylamine 1.16% w/w + Linseed Oil + Methyl Salicylate + Menthol",
    form: DosageForm.GEL, packSize: "tube of 30 g", hsn: "30049099", gst: 1200,
    mrp: 135, sp: 118, stock: 140,
    salts: [{ name: "Diclofenac Diethylamine", strength: "1.16% w/w" }],
    shortDescription: "Topical gel for muscular and joint pain.",
    uses: "Local relief of back pain, muscular sprain, and joint stiffness.",
    howItWorks: "Diclofenac penetrates the skin to reduce local prostaglandin production; menthol provides an immediate cooling sensation.",
    sideEffects: "Local redness, itching or dryness at the site of application.",
    warnings: "For external use only. Do not apply to broken skin or mucous membranes. Wash hands after use.",
    directions: "Apply a thin layer to the affected area three to four times daily and massage gently.",
  },
  {
    name: "Moov Pain Relief Cream", brand: "Moov", category: "pain-relief-fever",
    manufacturer: "Reckitt Benckiser (India) Pvt Ltd", scheduleType: ScheduleType.OTC,
    composition: "Mephenesin 10% w/w + Diclofenac Diethylamine 1.16% w/w + Menthol 5% w/w",
    form: DosageForm.CREAM, packSize: "tube of 30 g", hsn: "30049099", gst: 1200,
    mrp: 145, sp: 128, stock: 95,
    salts: [{ name: "Mephenesin", strength: "10% w/w" }],
    shortDescription: "Topical cream for backache and muscular stiffness.",
    uses: "Local relief of back pain, muscular stiffness and sprain.",
    howItWorks: "Mephenesin relaxes local muscle spasm while diclofenac reduces inflammatory mediators in the tissue.",
    sideEffects: "Mild local irritation or redness.",
    warnings: "External use only. Avoid contact with eyes.",
    directions: "Massage gently into the affected area up to three times daily.",
  },

  // --- Antibiotics: Schedule H ---------------------------------------------
  {
    name: "Azithral 500 Tablet", brand: "Azithral", category: "antibiotics",
    manufacturer: "Alembic Pharmaceuticals Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Azithromycin 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 5 tablets", hsn: "30042019", gst: 1200, mrp: 123, sp: 104.5, stock: 60,
    salts: [{ name: "Azithromycin", strength: "500 mg" }],
    shortDescription: "Macrolide antibiotic, once-daily dosing.",
    uses: "Bacterial infections of the throat, chest, skin and soft tissue, and certain sexually transmitted infections.",
    howItWorks: "Azithromycin binds the bacterial 50S ribosomal subunit and halts protein synthesis, stopping bacterial multiplication.",
    sideEffects: "Nausea, abdominal pain, diarrhoea, altered taste. Rarely liver enzyme elevation.",
    warnings: "Complete the full course even if you feel better; stopping early promotes resistance. Tell your doctor about any heart rhythm condition.",
    directions: "One tablet daily at the same time each day, as prescribed. May be taken with or without food.",
  },
  {
    name: "Augmentin 625 Duo Tablet", brand: "Augmentin", category: "antibiotics",
    manufacturer: "GlaxoSmithKline Pharmaceuticals Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Amoxicillin 500mg + Clavulanic Acid 125mg", strength: "500 mg + 125 mg",
    form: DosageForm.TABLET, packSize: "strip of 10 tablets", hsn: "30041020", gst: 1200,
    mrp: 223, sp: 192, stock: 75,
    salts: [{ name: "Amoxicillin", strength: "500 mg" }, { name: "Clavulanic Acid", strength: "125 mg" }],
    shortDescription: "Broad-spectrum penicillin with beta-lactamase inhibitor.",
    uses: "Respiratory tract, urinary tract, skin and dental infections caused by susceptible bacteria.",
    howItWorks: "Amoxicillin disrupts bacterial cell wall synthesis; clavulanic acid blocks the enzyme bacteria use to inactivate it.",
    sideEffects: "Diarrhoea, nausea, rash. Rarely severe allergic reaction.",
    warnings: "Do not take if you have had an allergic reaction to any penicillin. Complete the full prescribed course.",
    directions: "One tablet every 12 hours with the first bite of a meal, as prescribed.",
  },
  {
    name: "Mox 500 Capsule", brand: "Mox", category: "antibiotics",
    manufacturer: "Sun Pharmaceutical Industries Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Amoxicillin 500mg", strength: "500 mg", form: DosageForm.CAPSULE,
    packSize: "strip of 15 capsules", hsn: "30041020", gst: 1200, mrp: 98, sp: 84, stock: 88,
    salts: [{ name: "Amoxicillin", strength: "500 mg" }],
    shortDescription: "Penicillin-class antibiotic capsule.",
    uses: "Infections of the ear, nose, throat, chest, urinary tract and skin.",
    howItWorks: "Amoxicillin prevents bacteria from building a functional cell wall, causing them to rupture.",
    sideEffects: "Nausea, diarrhoea, rash.",
    warnings: "Not for anyone with penicillin allergy. Finish the course as prescribed.",
    directions: "One capsule every 8 hours, as prescribed.",
  },
  {
    name: "Doxt-SL Capsule", brand: "Doxt", category: "antibiotics",
    manufacturer: "Ajanta Pharma Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Doxycycline 100mg + Lactic Acid Bacillus 5 billion spores",
    strength: "100 mg", form: DosageForm.CAPSULE, packSize: "strip of 10 capsules",
    hsn: "30042039", gst: 1200, mrp: 108, sp: 92, stock: 54,
    salts: [{ name: "Doxycycline", strength: "100 mg" }],
    shortDescription: "Tetracycline antibiotic with probiotic.",
    uses: "Acne, respiratory infections, and certain tick-borne and atypical infections.",
    howItWorks: "Doxycycline blocks bacterial protein synthesis at the 30S ribosome; the added lactic acid bacillus helps maintain gut flora during the course.",
    sideEffects: "Nausea, sensitivity to sunlight, throat irritation if taken without water.",
    warnings: "Take with a full glass of water and remain upright for 30 minutes. Avoid in pregnancy and in children under 12.",
    directions: "One capsule daily after food, or as prescribed.",
  },
  {
    name: "Metrogyl 400 Tablet", brand: "Metrogyl", category: "antibiotics",
    manufacturer: "JB Chemicals & Pharmaceuticals Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Metronidazole 400mg", strength: "400 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30042099", gst: 1200, mrp: 32, sp: 28, stock: 120,
    salts: [{ name: "Metronidazole", strength: "400 mg" }],
    shortDescription: "Antibacterial and antiprotozoal tablet.",
    uses: "Anaerobic bacterial infections, amoebiasis, giardiasis and certain dental infections.",
    howItWorks: "Metronidazole is activated inside anaerobic organisms, where it damages their DNA.",
    sideEffects: "Metallic taste, nausea, headache, dark urine.",
    warnings: "Do not consume alcohol during the course and for 48 hours after — the combination causes severe flushing and vomiting.",
    directions: "One tablet three times daily after food, as prescribed.",
  },

  // --- Schedule H1 (Rule 65(11A)) ------------------------------------------
  {
    name: "Zifi 200 Tablet", brand: "Zifi", category: "antibiotics",
    manufacturer: "FDC Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Cefixime 200mg", strength: "200 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30042019", gst: 1200, mrp: 178, sp: 152, stock: 42,
    salts: [{ name: "Cefixime", strength: "200 mg" }],
    shortDescription: "Third-generation cephalosporin. Schedule H1.",
    uses: "Urinary tract infections, throat infections, bronchitis and typhoid fever.",
    howItWorks: "Cefixime interferes with bacterial cell wall construction, causing the cell to break down.",
    sideEffects: "Diarrhoea, nausea, abdominal pain, rash.",
    warnings: "Schedule H1 drug. Supply is recorded in a statutory register with the prescriber's details. Complete the full course; do not keep leftovers for later use.",
    directions: "One tablet every 12 hours after food, as prescribed.",
  },
  {
    name: "Levoflox 500 Tablet", brand: "Levoflox", category: "antibiotics",
    manufacturer: "Cipla Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Levofloxacin 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 5 tablets", hsn: "30042019", gst: 1200, mrp: 164, sp: 141, stock: 38,
    salts: [{ name: "Levofloxacin", strength: "500 mg" }],
    shortDescription: "Fluoroquinolone antibiotic. Schedule H1.",
    uses: "Pneumonia, sinusitis, urinary tract infections and skin infections.",
    howItWorks: "Levofloxacin inhibits bacterial DNA gyrase, preventing the bacteria from replicating their DNA.",
    sideEffects: "Nausea, headache, dizziness, sleep disturbance. Rarely tendon pain or inflammation.",
    warnings: "Schedule H1 drug, recorded in a statutory register. Stop and seek advice if you develop tendon pain. Avoid excessive sun exposure during the course.",
    directions: "One tablet daily, at least two hours apart from antacids or iron supplements.",
  },
  {
    name: "Moxicip 400 Tablet", brand: "Moxicip", category: "antibiotics",
    manufacturer: "Cipla Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Moxifloxacin 400mg", strength: "400 mg", form: DosageForm.TABLET,
    packSize: "strip of 5 tablets", hsn: "30042019", gst: 1200, mrp: 512, sp: 445, stock: 24,
    salts: [{ name: "Moxifloxacin", strength: "400 mg" }],
    shortDescription: "Fourth-generation fluoroquinolone. Schedule H1.",
    uses: "Community-acquired pneumonia, sinusitis and complicated skin infections.",
    howItWorks: "Moxifloxacin blocks the bacterial enzymes DNA gyrase and topoisomerase IV, halting DNA replication.",
    sideEffects: "Nausea, diarrhoea, dizziness, changes in heart rhythm in susceptible people.",
    warnings: "Schedule H1 drug, recorded in a statutory register. Tell your doctor about any heart rhythm disorder before starting.",
    directions: "One tablet once daily at the same time each day, as prescribed.",
  },
  {
    name: "Zenflox 200 Tablet", brand: "Zenflox", category: "antibiotics",
    manufacturer: "Mankind Pharma Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Ofloxacin 200mg", strength: "200 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30042019", gst: 1200, mrp: 96, sp: 82, stock: 46,
    salts: [{ name: "Ofloxacin", strength: "200 mg" }],
    shortDescription: "Fluoroquinolone antibiotic. Schedule H1.",
    uses: "Urinary tract infections, bronchitis, and certain gastrointestinal infections.",
    howItWorks: "Ofloxacin inhibits bacterial DNA gyrase, preventing bacterial DNA from being copied.",
    sideEffects: "Nausea, dizziness, headache, sleep disturbance.",
    warnings: "Schedule H1 drug, recorded in a statutory register. Avoid antacids within two hours of the dose.",
    directions: "One tablet twice daily after food, as prescribed.",
  },
  {
    name: "Monocef-O 200 Tablet", brand: "Monocef", category: "antibiotics",
    manufacturer: "Aristo Pharmaceuticals Pvt Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Cefpodoxime Proxetil 200mg", strength: "200 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30042019", gst: 1200, mrp: 214, sp: 184, stock: 30,
    salts: [{ name: "Cefpodoxime", strength: "200 mg" }],
    shortDescription: "Oral cephalosporin. Schedule H1.",
    uses: "Respiratory tract infections, urinary tract infections and skin infections.",
    howItWorks: "Cefpodoxime disrupts the synthesis of the bacterial cell wall.",
    sideEffects: "Diarrhoea, nausea, abdominal discomfort.",
    warnings: "Schedule H1 drug, recorded in a statutory register. Not for anyone with a cephalosporin allergy.",
    directions: "One tablet every 12 hours with food, as prescribed.",
  },
  {
    name: "AKT-4 Kit", brand: "AKT", category: "antibiotics",
    manufacturer: "Lupin Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Rifampicin 450mg + Isoniazid 300mg + Pyrazinamide 750mg + Ethambutol 800mg",
    form: DosageForm.TABLET, packSize: "kit of 28 tablets", hsn: "30042031", gst: 1200,
    mrp: 386, sp: 340, stock: 18,
    salts: [
      { name: "Rifampicin", strength: "450 mg" },
      { name: "Isoniazid", strength: "300 mg" },
      { name: "Pyrazinamide", strength: "750 mg" },
      { name: "Ethambutol", strength: "800 mg" },
    ],
    shortDescription: "Four-drug anti-tubercular kit. Schedule H1.",
    uses: "Intensive-phase anti-tubercular therapy, under specialist supervision.",
    howItWorks: "The four drugs act on different bacterial targets simultaneously, which reduces the chance of resistance emerging during a long course.",
    sideEffects: "Orange discolouration of urine and tears, nausea, joint pain, tingling in the hands and feet, liver enzyme changes.",
    warnings: "Schedule H1 drug, recorded in a statutory register. Never interrupt or self-discontinue anti-tubercular therapy — irregular dosing is the main driver of drug resistance. Regular liver function monitoring is required.",
    directions: "Take the full daily kit on an empty stomach, exactly as directed by the treating physician.",
  },

  // --- Diabetes (Schedule H) ------------------------------------------------
  {
    name: "Glycomet 500 Tablet", brand: "Glycomet", category: "diabetes-care",
    manufacturer: "USV Pvt Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Metformin Hydrochloride 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 20 tablets", hsn: "30049099", gst: 1200, mrp: 38, sp: 33, stock: 160,
    salts: [{ name: "Metformin", strength: "500 mg" }],
    shortDescription: "First-line oral antidiabetic.",
    uses: "Management of type 2 diabetes mellitus, alongside diet and exercise.",
    howItWorks: "Metformin reduces glucose production by the liver and improves the body's sensitivity to its own insulin.",
    sideEffects: "Nausea, metallic taste, loose stools — usually settling after the first weeks. Long-term use may lower vitamin B12.",
    warnings: "Tell your doctor before any scan involving contrast dye. Stop and seek advice during severe dehydration or acute illness.",
    directions: "One tablet once or twice daily with meals, as prescribed.",
  },
  {
    name: "Glimestar-M2 Tablet", brand: "Glimestar", category: "diabetes-care",
    manufacturer: "Mankind Pharma Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Glimepiride 2mg + Metformin 500mg", strength: "2 mg + 500 mg",
    form: DosageForm.TABLET, packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200,
    mrp: 132, sp: 114, stock: 70,
    salts: [{ name: "Glimepiride", strength: "2 mg" }, { name: "Metformin", strength: "500 mg" }],
    shortDescription: "Sulfonylurea plus metformin combination.",
    uses: "Type 2 diabetes mellitus where a single agent has not achieved target control.",
    howItWorks: "Glimepiride prompts the pancreas to release more insulin; metformin lowers hepatic glucose output and improves insulin sensitivity.",
    sideEffects: "Low blood sugar, weight gain, nausea, loose stools.",
    warnings: "Carry a source of fast-acting sugar. Do not skip meals after taking this tablet.",
    directions: "One tablet daily with breakfast, or as prescribed.",
  },
  {
    name: "Januvia 100mg Tablet", brand: "Januvia", category: "diabetes-care",
    manufacturer: "MSD Pharmaceuticals Pvt Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Sitagliptin Phosphate 100mg", strength: "100 mg", form: DosageForm.TABLET,
    packSize: "strip of 7 tablets", hsn: "30049099", gst: 1200, mrp: 205, sp: 182, stock: 44,
    salts: [{ name: "Sitagliptin", strength: "100 mg" }],
    shortDescription: "DPP-4 inhibitor, once daily.",
    uses: "Type 2 diabetes mellitus, as add-on or monotherapy.",
    howItWorks: "Sitagliptin blocks the DPP-4 enzyme, prolonging the action of incretin hormones that increase insulin release when blood glucose rises.",
    sideEffects: "Headache, upper respiratory symptoms, nausea. Rarely pancreatitis.",
    warnings: "Seek immediate advice for severe, persistent abdominal pain. Dose adjustment is needed in kidney impairment.",
    directions: "One tablet once daily, with or without food.",
  },
  {
    name: "Lantus SoloStar 100IU/ml Injection", brand: "Lantus", category: "diabetes-care",
    manufacturer: "Sanofi India Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Insulin Glargine 100IU/ml", strength: "100 IU/ml", form: DosageForm.INJECTION,
    packSize: "prefilled pen of 3 ml", hsn: "30043110", gst: 500, mrp: 852, sp: 782, stock: 16,
    refrigerated: true,
    salts: [{ name: "Insulin Glargine", strength: "100 IU/ml" }],
    shortDescription: "Long-acting basal insulin analogue. Cold-chain item.",
    uses: "Diabetes mellitus requiring basal insulin.",
    howItWorks: "Insulin glargine forms a micro-precipitate under the skin that releases slowly, giving a steady background insulin level over roughly 24 hours.",
    sideEffects: "Low blood sugar, injection-site reaction, weight gain.",
    warnings: "Never share an insulin pen. Rotate injection sites. Do not freeze; discard if the solution is cloudy or discoloured.",
    directions: "Inject subcutaneously once daily at the same time each day, as prescribed.",
    storage: STORE_COLD,
  },

  // --- Heart & blood pressure (Schedule H) ---------------------------------
  {
    name: "Ecosprin 75mg Tablet", brand: "Ecosprin", category: "heart-blood-pressure",
    manufacturer: "USV Pvt Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Aspirin 75mg", strength: "75 mg", form: DosageForm.TABLET,
    packSize: "strip of 14 tablets", hsn: "30049099", gst: 1200, mrp: 12, sp: 10.5, stock: 220,
    salts: [{ name: "Aspirin", strength: "75 mg" }],
    shortDescription: "Low-dose aspirin for cardiovascular protection.",
    uses: "Long-term reduction of clot formation in people with established cardiovascular disease.",
    howItWorks: "At low dose, aspirin permanently blocks an enzyme in platelets, making them less likely to clump together.",
    sideEffects: "Stomach irritation, easy bruising, prolonged bleeding from cuts.",
    warnings: "Tell your dentist or surgeon before any procedure. Do not stop abruptly without medical advice.",
    directions: "One tablet daily after food, as prescribed.",
  },
  {
    name: "Telma 40 Tablet", brand: "Telma", category: "heart-blood-pressure",
    manufacturer: "Glenmark Pharmaceuticals Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Telmisartan 40mg", strength: "40 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 148, sp: 128, stock: 130,
    salts: [{ name: "Telmisartan", strength: "40 mg" }],
    shortDescription: "Angiotensin receptor blocker for blood pressure.",
    uses: "High blood pressure, and cardiovascular risk reduction.",
    howItWorks: "Telmisartan blocks the receptor that angiotensin II acts on, allowing blood vessels to relax and widen.",
    sideEffects: "Dizziness on standing, back pain, raised potassium.",
    warnings: "Not to be used in pregnancy. Rise slowly from sitting for the first few days.",
    directions: "One tablet once daily, with or without food.",
  },
  {
    name: "Telma-AM Tablet", brand: "Telma", category: "heart-blood-pressure",
    manufacturer: "Glenmark Pharmaceuticals Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Telmisartan 40mg + Amlodipine 5mg", strength: "40 mg + 5 mg",
    form: DosageForm.TABLET, packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200,
    mrp: 198, sp: 172, stock: 92,
    salts: [{ name: "Telmisartan", strength: "40 mg" }, { name: "Amlodipine", strength: "5 mg" }],
    shortDescription: "Two-drug combination for blood pressure control.",
    uses: "High blood pressure not adequately controlled on a single agent.",
    howItWorks: "Telmisartan blocks angiotensin II receptors while amlodipine relaxes the muscle in artery walls; the two act on different pathways.",
    sideEffects: "Ankle swelling, dizziness, flushing, headache.",
    warnings: "Not to be used in pregnancy. Report persistent ankle swelling to your doctor.",
    directions: "One tablet once daily at the same time each day.",
  },
  {
    name: "Amlong 5 Tablet", brand: "Amlong", category: "heart-blood-pressure",
    manufacturer: "Micro Labs Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Amlodipine 5mg", strength: "5 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 62, sp: 54, stock: 150,
    salts: [{ name: "Amlodipine", strength: "5 mg" }],
    shortDescription: "Calcium channel blocker for blood pressure.",
    uses: "High blood pressure and stable angina.",
    howItWorks: "Amlodipine relaxes the smooth muscle of artery walls, lowering the resistance the heart pumps against.",
    sideEffects: "Ankle swelling, flushing, headache, palpitations.",
    warnings: "Do not stop suddenly without advice. Report significant ankle swelling.",
    directions: "One tablet once daily.",
  },
  {
    name: "Rosuvas 10 Tablet", brand: "Rosuvas", category: "heart-blood-pressure",
    manufacturer: "Sun Pharmaceutical Industries Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Rosuvastatin 10mg", strength: "10 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30049099", gst: 1200, mrp: 168, sp: 145, stock: 110,
    salts: [{ name: "Rosuvastatin", strength: "10 mg" }],
    shortDescription: "Statin for cholesterol management.",
    uses: "Elevated cholesterol and cardiovascular risk reduction.",
    howItWorks: "Rosuvastatin inhibits HMG-CoA reductase, the enzyme the liver uses to make cholesterol, and increases clearance of LDL from the blood.",
    sideEffects: "Muscle aches, headache, nausea, liver enzyme changes.",
    warnings: "Report unexplained muscle pain, tenderness or weakness promptly. Not for use in pregnancy.",
    directions: "One tablet once daily, usually in the evening.",
  },
  {
    name: "Met XL 25 Tablet", brand: "Met XL", category: "heart-blood-pressure",
    manufacturer: "Ajanta Pharma Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Metoprolol Succinate 25mg (Extended Release)", strength: "25 mg",
    form: DosageForm.TABLET, packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200,
    mrp: 78, sp: 68, stock: 96,
    salts: [{ name: "Metoprolol", strength: "25 mg" }],
    shortDescription: "Extended-release beta blocker.",
    uses: "High blood pressure, angina, and certain heart rhythm and heart failure indications.",
    howItWorks: "Metoprolol blocks beta-1 receptors in the heart, slowing the rate and reducing the force of contraction.",
    sideEffects: "Tiredness, slow pulse, cold hands and feet, dizziness.",
    warnings: "Never stop abruptly — sudden withdrawal can worsen angina. Use with caution in asthma.",
    directions: "One tablet once daily, swallowed whole. Do not crush or chew.",
  },

  // --- Stomach & digestion --------------------------------------------------
  {
    name: "Pan 40 Tablet", brand: "Pan", category: "stomach-digestion",
    manufacturer: "Alkem Laboratories Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Pantoprazole 40mg", strength: "40 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 142, sp: 122, stock: 175,
    salts: [{ name: "Pantoprazole", strength: "40 mg" }],
    shortDescription: "Proton pump inhibitor for acid reduction.",
    uses: "Acid reflux, gastric and duodenal ulcer, and protection against ulcers from long-term painkiller use.",
    howItWorks: "Pantoprazole shuts down the proton pumps in the stomach lining that produce acid.",
    sideEffects: "Headache, diarrhoea, flatulence. Long courses may affect magnesium and vitamin B12.",
    warnings: "Take before food for full effect. Long-term use should be reviewed periodically by your doctor.",
    directions: "One tablet daily, 30 to 60 minutes before breakfast.",
  },
  {
    name: "Omez 20 Capsule", brand: "Omez", category: "stomach-digestion",
    manufacturer: "Dr Reddy's Laboratories Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Omeprazole 20mg", strength: "20 mg", form: DosageForm.CAPSULE,
    packSize: "strip of 20 capsules", hsn: "30049099", gst: 1200, mrp: 106, sp: 91, stock: 140,
    salts: [{ name: "Omeprazole", strength: "20 mg" }],
    shortDescription: "Proton pump inhibitor capsule.",
    uses: "Acid reflux, heartburn and peptic ulcer.",
    howItWorks: "Omeprazole blocks the final step of acid secretion in the stomach lining.",
    sideEffects: "Headache, abdominal pain, nausea, flatulence.",
    warnings: "Swallow whole before food. Review long-term use with your doctor.",
    directions: "One capsule daily before breakfast.",
  },
  {
    name: "Digene Acidity & Gas Relief Gel — Mint", brand: "Digene", category: "stomach-digestion",
    manufacturer: "Abbott India Ltd", scheduleType: ScheduleType.OTC,
    composition: "Magnesium Hydroxide 185mg + Aluminium Hydroxide 830mg + Simethicone 50mg per 10ml",
    form: DosageForm.SUSPENSION, packSize: "bottle of 200 ml", hsn: "30049099", gst: 1200,
    mrp: 165, sp: 148, stock: 105,
    salts: [{ name: "Magnesium Hydroxide", strength: "185 mg" }, { name: "Aluminium Hydroxide", strength: "830 mg" }],
    shortDescription: "Antacid suspension for acidity and bloating.",
    uses: "Fast relief of acidity, heartburn and gas-related discomfort.",
    howItWorks: "The hydroxide salts neutralise stomach acid directly, while simethicone breaks up trapped gas bubbles.",
    sideEffects: "Loose stools or constipation, chalky taste.",
    warnings: "Take at least two hours apart from other medicines, which it can interfere with.",
    directions: "Two teaspoonfuls after meals and at bedtime, or as needed.",
  },
  {
    name: "Eno Fruit Salt — Regular", brand: "Eno", category: "stomach-digestion",
    manufacturer: "Haleon India", scheduleType: ScheduleType.OTC,
    composition: "Sodium Bicarbonate 2.32g + Sodium Carbonate 0.5g + Citric Acid 2.18g per 5g",
    form: DosageForm.POWDER, packSize: "bottle of 100 g", hsn: "30049099", gst: 1200,
    mrp: 132, sp: 120, stock: 130,
    salts: [{ name: "Sodium Bicarbonate", strength: "2.32 g" }],
    shortDescription: "Effervescent antacid powder.",
    uses: "Rapid relief of acidity and heartburn.",
    howItWorks: "The bicarbonate reacts with stomach acid on contact, neutralising it within seconds.",
    sideEffects: "Belching, bloating.",
    warnings: "High sodium content — use with caution if you are on a salt-restricted diet.",
    directions: "Dissolve one 5 g measure in a glass of water and drink immediately.",
  },
  {
    name: "Cremaffin Syrup", brand: "Cremaffin", category: "stomach-digestion",
    manufacturer: "Abbott India Ltd", scheduleType: ScheduleType.OTC,
    composition: "Milk of Magnesia 11.25ml + Liquid Paraffin 3.75ml per 15ml",
    form: DosageForm.SYRUP, packSize: "bottle of 225 ml", hsn: "30049099", gst: 1200,
    mrp: 198, sp: 178, stock: 88,
    salts: [{ name: "Liquid Paraffin", strength: "3.75 ml" }],
    shortDescription: "Gentle laxative syrup.",
    uses: "Short-term relief of constipation.",
    howItWorks: "Magnesium hydroxide draws water into the bowel while liquid paraffin softens and lubricates the stool.",
    sideEffects: "Abdominal cramps, loose stools.",
    warnings: "Not for prolonged use. Seek advice if constipation persists beyond a week.",
    directions: "One to two tablespoonfuls at bedtime, or as directed.",
  },

  // --- Cold, cough & allergy ------------------------------------------------
  {
    name: "Cetzine 10mg Tablet", brand: "Cetzine", category: "cold-cough-allergy",
    manufacturer: "Haleon India", scheduleType: ScheduleType.OTC,
    composition: "Cetirizine Hydrochloride 10mg", strength: "10 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30049099", gst: 1200, mrp: 42, sp: 37, stock: 190,
    salts: [{ name: "Cetirizine", strength: "10 mg" }],
    shortDescription: "Once-daily antihistamine.",
    uses: "Relief of sneezing, runny nose, itchy eyes and hives.",
    howItWorks: "Cetirizine blocks histamine H1 receptors, damping the allergic response that causes itching and swelling.",
    sideEffects: "Drowsiness, dry mouth, tiredness.",
    warnings: "May cause drowsiness. Do not drive or operate machinery until you know how it affects you.",
    directions: "One tablet at night, or as directed.",
  },
  {
    name: "Allegra 120mg Tablet", brand: "Allegra", category: "cold-cough-allergy",
    manufacturer: "Sanofi India Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Fexofenadine Hydrochloride 120mg", strength: "120 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30049099", gst: 1200, mrp: 216, sp: 188, stock: 84,
    salts: [{ name: "Fexofenadine", strength: "120 mg" }],
    shortDescription: "Non-drowsy antihistamine.",
    uses: "Seasonal allergic rhinitis and chronic hives.",
    howItWorks: "Fexofenadine blocks peripheral histamine H1 receptors and crosses into the brain far less than older antihistamines.",
    sideEffects: "Headache, nausea, dizziness.",
    warnings: "Do not take with fruit juice, which reduces absorption.",
    directions: "One tablet daily with water.",
  },
  {
    name: "Sinarest Tablet", brand: "Sinarest", category: "cold-cough-allergy",
    manufacturer: "Centaur Pharmaceuticals Pvt Ltd", scheduleType: ScheduleType.OTC,
    composition: "Paracetamol 500mg + Phenylephrine 10mg + Chlorpheniramine Maleate 2mg + Caffeine 30mg",
    form: DosageForm.TABLET, packSize: "strip of 10 tablets", hsn: "30049099", gst: 1200,
    mrp: 96, sp: 85, stock: 120,
    salts: [{ name: "Paracetamol", strength: "500 mg" }, { name: "Phenylephrine", strength: "10 mg" }],
    shortDescription: "Combination tablet for cold symptoms.",
    uses: "Relief of blocked nose, runny nose, sneezing, headache and fever associated with the common cold.",
    howItWorks: "Phenylephrine narrows swollen nasal blood vessels, chlorpheniramine reduces the allergic component, and paracetamol addresses fever and headache.",
    sideEffects: "Drowsiness, dry mouth, restlessness, raised blood pressure.",
    warnings: "Contains paracetamol — do not combine with other paracetamol products. Use with caution if you have high blood pressure.",
    directions: "One tablet every 8 hours after food, for no more than five days.",
  },
  {
    name: "Otrivin Adult Nasal Spray", brand: "Otrivin", category: "cold-cough-allergy",
    manufacturer: "Haleon India", scheduleType: ScheduleType.OTC,
    composition: "Xylometazoline Hydrochloride 0.1% w/v", strength: "0.1% w/v",
    form: DosageForm.SPRAY, packSize: "bottle of 10 ml", hsn: "30049099", gst: 1200,
    mrp: 98, sp: 88, stock: 110,
    salts: [{ name: "Xylometazoline", strength: "0.1% w/v" }],
    shortDescription: "Fast-acting nasal decongestant spray.",
    uses: "Short-term relief of a blocked nose.",
    howItWorks: "Xylometazoline constricts the swollen blood vessels in the nasal lining, opening the airway within minutes.",
    sideEffects: "Local stinging, dryness, sneezing.",
    warnings: "Do not use for more than five consecutive days — prolonged use causes rebound congestion. One bottle per person.",
    directions: "One spray into each nostril, up to three times daily.",
  },
  {
    name: "Vicks VapoRub", brand: "Vicks", category: "cold-cough-allergy",
    manufacturer: "Procter & Gamble Hygiene and Health Care Ltd", scheduleType: ScheduleType.OTC,
    composition: "Menthol 2.6% w/w + Camphor 5.25% w/w + Eucalyptus Oil 1.2% w/w + Turpentine Oil 5% w/w",
    form: DosageForm.OINTMENT, packSize: "jar of 50 ml", hsn: "30049099", gst: 1200,
    mrp: 165, sp: 152, stock: 165, nameHi: "विक्स वेपोरब",
    salts: [{ name: "Menthol", strength: "2.6% w/w" }, { name: "Camphor", strength: "5.25% w/w" }],
    shortDescription: "Topical vapour rub for cold symptoms.",
    uses: "Eases a blocked nose and cough associated with the common cold.",
    howItWorks: "The menthol and camphor vapours produce a cooling sensation in the airway that makes breathing feel easier.",
    sideEffects: "Local skin irritation in sensitive individuals.",
    warnings: "For external use only. Not for children under 2 years. Do not apply to broken skin or inside the nostrils.",
    directions: "Rub onto the chest, throat and back at bedtime.",
  },
  {
    name: "Electral Powder — Orange", brand: "Electral", category: "stomach-digestion",
    manufacturer: "FDC Ltd", scheduleType: ScheduleType.OTC,
    composition: "Sodium Chloride 0.52g + Potassium Chloride 0.30g + Sodium Citrate 0.58g + Dextrose 2.7g per 4.4g",
    form: DosageForm.SACHET, packSize: "sachet of 21.8 g", hsn: "30049099", gst: 1200,
    mrp: 22, sp: 20, stock: 400,
    salts: [{ name: "Oral Rehydration Salts", strength: "21.8 g" }],
    shortDescription: "WHO-formula oral rehydration salts.",
    uses: "Replaces water and electrolytes lost through diarrhoea, vomiting or heat exposure.",
    howItWorks: "The glucose-sodium ratio uses the gut's co-transport mechanism to pull water back into the body far faster than plain water.",
    sideEffects: "Nausea if taken too quickly.",
    warnings: "Dissolve in one litre of clean drinking water — never in milk, juice or a smaller volume. Discard unused solution after 24 hours.",
    directions: "Dissolve one sachet in 1 litre of water and sip frequently.",
  },

  // --- Vitamins & supplements (NUTRACEUTICAL — claim-restricted copy) -------
  {
    name: "Shelcal 500 Tablet", brand: "Shelcal", category: "minerals",
    manufacturer: "Torrent Pharmaceuticals Ltd", scheduleType: ScheduleType.NUTRACEUTICAL,
    composition: "Calcium Carbonate 1250mg (elemental Calcium 500mg) + Vitamin D3 250IU",
    form: DosageForm.TABLET, packSize: "strip of 15 tablets", hsn: "21069099", gst: 1800,
    mrp: 118, sp: 104, stock: 210,
    salts: [{ name: "Calcium Carbonate", strength: "1250 mg" }, { name: "Cholecalciferol", strength: "250 IU" }],
    shortDescription: "Calcium and vitamin D3 supplement.",
    uses: "A dietary source of calcium and vitamin D3, which contribute to the maintenance of normal bones and teeth.",
    howItWorks: "Vitamin D3 supports the normal absorption of dietary calcium.",
    sideEffects: "Constipation, bloating.",
    warnings: "Food supplement. Not a substitute for a varied diet. Do not exceed the recommended daily dose.",
    directions: "One tablet daily after a meal, or as advised.",
  },
  {
    name: "Zincovit Tablet", brand: "Zincovit", category: "multivitamins",
    manufacturer: "Apex Laboratories Pvt Ltd", scheduleType: ScheduleType.NUTRACEUTICAL,
    composition: "Multivitamin, multimineral and grape seed extract blend with Zinc 22mg",
    form: DosageForm.TABLET, packSize: "strip of 15 tablets", hsn: "21069099", gst: 1800,
    mrp: 108, sp: 96, stock: 260,
    salts: [{ name: "Zinc", strength: "22 mg" }],
    shortDescription: "Daily multivitamin with zinc.",
    uses: "A dietary source of vitamins and minerals. Zinc contributes to the normal function of the immune system.",
    howItWorks: "Supplies micronutrients that support normal metabolic function where dietary intake is inadequate.",
    sideEffects: "Mild nausea if taken on an empty stomach.",
    warnings: "Food supplement. Not a substitute for a varied diet.",
    directions: "One tablet daily after food.",
  },
  {
    name: "Neurobion Forte Tablet", brand: "Neurobion", category: "multivitamins",
    manufacturer: "Merck Ltd", scheduleType: ScheduleType.NUTRACEUTICAL,
    composition: "Vitamin B1 10mg + B2 10mg + B6 3mg + B12 15mcg + Niacinamide 45mg + Calcium Pantothenate 50mg",
    form: DosageForm.TABLET, packSize: "strip of 30 tablets", hsn: "21069099", gst: 1800,
    mrp: 42, sp: 38, stock: 300,
    salts: [{ name: "Vitamin B Complex", strength: "30 tablets" }],
    shortDescription: "B-complex vitamin supplement.",
    uses: "A dietary source of B-group vitamins, which contribute to normal energy-yielding metabolism and normal functioning of the nervous system.",
    howItWorks: "B vitamins act as cofactors in the metabolic pathways that release energy from food.",
    sideEffects: "Harmless yellow discolouration of urine.",
    warnings: "Food supplement. Not a substitute for a varied diet.",
    directions: "One tablet daily after food.",
  },
  {
    name: "Limcee Vitamin C 500mg Chewable Tablet", brand: "Limcee", category: "multivitamins",
    manufacturer: "Abbott India Ltd", scheduleType: ScheduleType.NUTRACEUTICAL,
    composition: "Ascorbic Acid 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "21069099", gst: 1800, mrp: 32, sp: 29, stock: 280,
    salts: [{ name: "Ascorbic Acid", strength: "500 mg" }],
    shortDescription: "Chewable vitamin C, orange flavour.",
    uses: "A dietary source of vitamin C, which contributes to the normal function of the immune system and to normal collagen formation.",
    howItWorks: "Vitamin C acts as an antioxidant and is a required cofactor for collagen synthesis.",
    sideEffects: "Acidity or loose stools at high doses.",
    warnings: "Food supplement. Not a substitute for a varied diet.",
    directions: "One tablet daily, chewed.",
  },
  {
    name: "Supradyn Daily Tablet", brand: "Supradyn", category: "multivitamins",
    manufacturer: "Bayer Pharmaceuticals Pvt Ltd", scheduleType: ScheduleType.NUTRACEUTICAL,
    composition: "Multivitamin and multimineral blend with Coenzyme Q10",
    form: DosageForm.TABLET, packSize: "strip of 15 tablets", hsn: "21069099", gst: 1800,
    mrp: 124, sp: 112, stock: 175,
    salts: [{ name: "Multivitamin", strength: "15 tablets" }],
    shortDescription: "Daily multivitamin with coenzyme Q10.",
    uses: "A dietary source of vitamins and minerals, which contribute to normal energy-yielding metabolism.",
    howItWorks: "Provides micronutrient cofactors used across normal metabolic pathways.",
    sideEffects: "Mild stomach upset if taken without food.",
    warnings: "Food supplement. Not a substitute for a varied diet.",
    directions: "One tablet daily after breakfast.",
  },
  {
    name: "Revital H Capsule for Men", brand: "Revital", category: "multivitamins",
    manufacturer: "Sun Pharmaceutical Industries Ltd", scheduleType: ScheduleType.NUTRACEUTICAL,
    composition: "Ginseng extract 42.5mg with multivitamins and minerals",
    form: DosageForm.CAPSULE, packSize: "bottle of 30 capsules", hsn: "21069099", gst: 1800,
    mrp: 385, sp: 348, stock: 120,
    salts: [{ name: "Ginseng Extract", strength: "42.5 mg" }],
    shortDescription: "Daily supplement with ginseng.",
    uses: "A dietary source of vitamins and minerals, which contribute to the reduction of tiredness and fatigue.",
    howItWorks: "Supplies micronutrients involved in normal energy metabolism.",
    sideEffects: "Occasional stomach upset.",
    warnings: "Food supplement. Not a substitute for a varied diet.",
    directions: "One capsule daily after breakfast.",
  },
  {
    name: "Protinex Original Powder", brand: "Protinex", category: "protein-nutrition",
    manufacturer: "Danone Nutricia India Pvt Ltd", scheduleType: ScheduleType.NUTRACEUTICAL,
    composition: "Hydrolysed protein blend 32g per 100g with vitamins and minerals",
    form: DosageForm.POWDER, packSize: "tin of 400 g", hsn: "21069099", gst: 1800,
    mrp: 620, sp: 558, stock: 90,
    salts: [{ name: "Hydrolysed Protein", strength: "32 g/100 g" }],
    shortDescription: "High-protein nutritional drink mix.",
    uses: "A dietary source of protein, which contributes to the maintenance of normal muscle mass.",
    howItWorks: "Supplies dietary protein in a readily digestible hydrolysed form.",
    sideEffects: "Bloating in people sensitive to milk protein.",
    warnings: "Food supplement. Contains milk. Not a substitute for a varied diet.",
    directions: "Add three tablespoonfuls to a glass of milk or water once or twice daily.",
  },

  // --- Ayurveda (claim-restricted copy) -------------------------------------
  {
    name: "Dabur Chyawanprash Awaleha", brand: "Dabur", category: "classical-formulations",
    manufacturer: "Dabur India Ltd", scheduleType: ScheduleType.AYURVEDIC,
    composition: "Amla, Ashwagandha, Pippali, Giloy and 40 other herbs in a jaggery and ghee base",
    form: DosageForm.OTHER, packSize: "jar of 500 g", hsn: "30039011", gst: 1200,
    mrp: 335, sp: 302, stock: 145, nameHi: "डाबर च्यवनप्राश",
    salts: [{ name: "Amla", strength: "500 g" }],
    shortDescription: "Classical ayurvedic herbal preparation with amla.",
    uses: "A traditional ayurvedic preparation, taken daily as part of a balanced routine. A dietary source of vitamin C from amla.",
    howItWorks: "Formulated according to a classical ayurvedic text, with amla as the principal ingredient.",
    sideEffects: "Occasional bloating if taken in excess.",
    warnings: "Contains sugar and ghee. Take on the advice of an ayurvedic practitioner if you are on other medication.",
    directions: "One to two teaspoonfuls daily, followed by warm milk.",
  },
  {
    name: "Himalaya Liv.52 Tablet", brand: "Himalaya", category: "herbal-supplements",
    manufacturer: "Himalaya Wellness Company", scheduleType: ScheduleType.AYURVEDIC,
    composition: "Himsra (Capparis spinosa) 65mg + Kasani (Cichorium intybus) 65mg + Kakamachi + Arjuna + Kasamarda + Biranjasipha",
    form: DosageForm.TABLET, packSize: "bottle of 100 tablets", hsn: "30039011", gst: 1200,
    mrp: 195, sp: 176, stock: 130,
    salts: [{ name: "Capparis Spinosa", strength: "65 mg" }],
    shortDescription: "Herbal formulation with Himsra and Kasani.",
    uses: "A traditional ayurvedic herbal formulation, used as part of a daily routine to support normal liver function.",
    howItWorks: "A polyherbal preparation combining Himsra and Kasani according to ayurvedic principles.",
    sideEffects: "Generally well tolerated.",
    warnings: "Consult an ayurvedic practitioner before use alongside other medication.",
    directions: "One to two tablets twice daily, or as advised.",
  },
  {
    name: "Himalaya Septilin Tablet", brand: "Himalaya", category: "herbal-supplements",
    manufacturer: "Himalaya Wellness Company", scheduleType: ScheduleType.AYURVEDIC,
    composition: "Guggulu 108mg + Guduchi 49mg + Licorice 32mg + Manjishtha + Shankha bhasma",
    form: DosageForm.TABLET, packSize: "strip of 60 tablets", hsn: "30039011", gst: 1200,
    mrp: 215, sp: 194, stock: 96,
    salts: [{ name: "Guggulu", strength: "108 mg" }],
    shortDescription: "Polyherbal formulation with Guggulu and Guduchi.",
    uses: "A traditional ayurvedic formulation taken to support normal immune function.",
    howItWorks: "Combines Guggulu, Guduchi and Licorice in a classical polyherbal ratio.",
    sideEffects: "Generally well tolerated.",
    warnings: "Consult an ayurvedic practitioner if you are pregnant or on other medication.",
    directions: "Two tablets twice daily, or as advised.",
  },
  {
    name: "Zandu Balm", brand: "Zandu", category: "classical-formulations",
    manufacturer: "Emami Ltd", scheduleType: ScheduleType.AYURVEDIC,
    composition: "Gaultheria Oil 44.5% + Menthol 10.5% + Eucalyptus Oil 15% + Camphor",
    form: DosageForm.OINTMENT, packSize: "bottle of 25 ml", hsn: "30039011", gst: 1200,
    mrp: 85, sp: 78, stock: 210, nameHi: "झंडू बाम",
    salts: [{ name: "Gaultheria Oil", strength: "44.5%" }],
    shortDescription: "Ayurvedic balm for muscular ache.",
    uses: "Traditionally applied for muscular ache, stiffness and heaviness of the head.",
    howItWorks: "Menthol and camphor produce a cooling then warming sensation at the site of application.",
    sideEffects: "Local irritation on sensitive skin.",
    warnings: "For external use only. Keep away from the eyes. Not for children under 2 years.",
    directions: "Apply a small quantity to the affected area and massage gently.",
  },
  {
    name: "Dabur Honitus Herbal Cough Syrup", brand: "Dabur", category: "herbal-supplements",
    manufacturer: "Dabur India Ltd", scheduleType: ScheduleType.AYURVEDIC,
    composition: "Tulsi, Mulethi, Banafsha, Vasaka and honey base",
    form: DosageForm.SYRUP, packSize: "bottle of 100 ml", hsn: "30039011", gst: 1200,
    mrp: 105, sp: 95, stock: 155,
    salts: [{ name: "Tulsi", strength: "100 ml" }],
    shortDescription: "Ayurvedic herbal syrup with tulsi and mulethi.",
    uses: "A traditional ayurvedic preparation taken for throat comfort.",
    howItWorks: "A honey-based herbal syrup that coats the throat, formulated with tulsi and mulethi.",
    sideEffects: "Generally well tolerated.",
    warnings: "Contains sugar and honey. Not suitable for infants under one year.",
    directions: "Two teaspoonfuls three times daily, or as advised.",
  },
  {
    name: "Baidyanath Ashwagandha Churna", brand: "Baidyanath", category: "herbal-supplements",
    manufacturer: "Shree Baidyanath Ayurved Bhawan Pvt Ltd", scheduleType: ScheduleType.AYURVEDIC,
    composition: "Withania somnifera root powder 100%", form: DosageForm.POWDER,
    packSize: "pack of 100 g", hsn: "30039011", gst: 1200, mrp: 145, sp: 130, stock: 110,
    nameHi: "अश्वगंधा चूर्ण",
    salts: [{ name: "Ashwagandha", strength: "100 g" }],
    shortDescription: "Single-herb ashwagandha root powder.",
    uses: "A traditional ayurvedic herb, taken as part of a daily routine.",
    howItWorks: "Classical single-herb churna prepared from dried Withania somnifera root.",
    sideEffects: "Occasional stomach upset when taken on an empty stomach.",
    warnings: "Consult an ayurvedic practitioner before use in pregnancy or alongside other medication.",
    directions: "Half to one teaspoonful with warm milk or water at bedtime.",
  },

  // --- Skin care (COSMETIC — claim-restricted copy) --------------------------
  {
    name: "Cetaphil Gentle Skin Cleanser", brand: "Cetaphil", category: "cleansers-moisturisers",
    manufacturer: "Galderma India Pvt Ltd", scheduleType: ScheduleType.COSMETIC,
    composition: "Water, Cetyl Alcohol, Propylene Glycol, Sodium Lauryl Sulfate, Stearyl Alcohol",
    form: DosageForm.SOLUTION, packSize: "bottle of 250 ml", hsn: "33049990", gst: 1800,
    mrp: 499, sp: 449, stock: 105,
    shortDescription: "Soap-free cleanser for sensitive skin.",
    uses: "Daily cleansing for sensitive skin. Non-foaming and fragrance-free.",
    howItWorks: "A low-irritant surfactant system lifts dirt and excess oil while leaving the skin's natural moisture largely intact.",
    sideEffects: "Rare local irritation.",
    warnings: "For external use only. Avoid contact with the eyes. Discontinue if irritation occurs.",
    directions: "Apply to damp skin, massage gently and rinse or wipe off.",
  },
  {
    name: "Minimalist 10% Niacinamide Face Serum", brand: "Minimalist", category: "cleansers-moisturisers",
    manufacturer: "Hindustan Unilever Ltd", scheduleType: ScheduleType.COSMETIC,
    composition: "Niacinamide 10% + Zinc PCA 1%", form: DosageForm.SOLUTION,
    packSize: "bottle of 30 ml", hsn: "33049990", gst: 1800, mrp: 599, sp: 509, stock: 88,
    shortDescription: "Niacinamide serum with zinc PCA.",
    uses: "Daily face serum for an even-looking skin tone and a shine-free finish.",
    howItWorks: "Niacinamide is a well-studied cosmetic ingredient used for the appearance of skin tone; zinc PCA helps manage surface oil.",
    sideEffects: "Transient tingling on first use.",
    warnings: "For external use only. Patch test before first use. Avoid the eye area.",
    directions: "Apply three to four drops to clean, dry skin at night, followed by a moisturiser.",
  },
  {
    name: "La Shield Sunscreen Gel SPF 40 PA+++", brand: "La Shield", category: "sun-care",
    manufacturer: "Glenmark Pharmaceuticals Ltd", scheduleType: ScheduleType.COSMETIC,
    composition: "Octinoxate, Zinc Oxide, Titanium Dioxide, Avobenzone",
    form: DosageForm.GEL, packSize: "tube of 50 g", hsn: "33049910", gst: 1800,
    mrp: 745, sp: 670, stock: 74,
    shortDescription: "Broad-spectrum SPF 40 sunscreen gel.",
    uses: "Daily broad-spectrum protection against UVA and UVB exposure. Non-greasy gel base.",
    howItWorks: "Combines mineral and organic filters that absorb and scatter ultraviolet light before it reaches the skin.",
    sideEffects: "Occasional local irritation on very sensitive skin.",
    warnings: "For external use only. Reapply every three hours during sustained sun exposure. Avoid contact with the eyes.",
    directions: "Apply generously to exposed skin 20 minutes before going outdoors.",
  },
  {
    name: "Venusia Max Intensive Moisturising Cream", brand: "Venusia", category: "cleansers-moisturisers",
    manufacturer: "Dr Reddy's Laboratories Ltd", scheduleType: ScheduleType.COSMETIC,
    composition: "Light Liquid Paraffin, Glycerin, Shea Butter, Vitamin E, Aloe Vera",
    form: DosageForm.CREAM, packSize: "tube of 150 g", hsn: "33049990", gst: 1800,
    mrp: 585, sp: 526, stock: 92,
    shortDescription: "Intensive moisturiser for very dry skin.",
    uses: "Daily moisturisation for very dry skin. Fragrance-free.",
    howItWorks: "Occlusive and humectant ingredients together reduce water loss from the skin surface.",
    sideEffects: "Rare local irritation.",
    warnings: "For external use only. Discontinue if irritation occurs.",
    directions: "Apply liberally to dry areas twice daily, ideally after a bath.",
  },
  {
    name: "Sebamed Clear Face Cleansing Foam", brand: "Sebamed", category: "cleansers-moisturisers",
    manufacturer: "Sebapharma GmbH & Co KG", scheduleType: ScheduleType.COSMETIC,
    composition: "Mild amphoteric surfactants at pH 5.5 with Panthenol and Allantoin",
    form: DosageForm.SOLUTION, packSize: "bottle of 150 ml", hsn: "33049990", gst: 1800,
    mrp: 620, sp: 558, stock: 66,
    shortDescription: "pH 5.5 cleansing foam for oily skin.",
    uses: "Daily facial cleansing for skin that looks oily or shiny.",
    howItWorks: "A pH 5.5 formulation matched to the skin's surface acidity, with mild surfactants that remove surface oil.",
    sideEffects: "Rare local dryness.",
    warnings: "For external use only. Avoid the eye area.",
    directions: "Massage onto damp skin morning and evening, then rinse.",
  },

  // --- Baby care -------------------------------------------------------------
  {
    name: "Himalaya Baby Lotion", brand: "Himalaya", category: "baby-bath-skin",
    manufacturer: "Himalaya Wellness Company", scheduleType: ScheduleType.COSMETIC,
    composition: "Olive Oil, Country Mallow (Bala), Licorice extract",
    form: DosageForm.LOTION, packSize: "bottle of 400 ml", hsn: "33049990", gst: 1800,
    mrp: 375, sp: 338, stock: 85,
    shortDescription: "Gentle daily lotion for babies.",
    uses: "Daily moisturisation of a baby's skin. Free from parabens.",
    howItWorks: "Olive oil and herbal extracts leave a light emollient film that reduces moisture loss.",
    sideEffects: "Rare local irritation.",
    warnings: "For external use only. Patch test before first use. Avoid the eye area.",
    directions: "Apply gently after a bath and massage in.",
  },
  {
    name: "Sebamed Baby Cleansing Bar", brand: "Sebamed", category: "baby-bath-skin",
    manufacturer: "Sebapharma GmbH & Co KG", scheduleType: ScheduleType.COSMETIC,
    composition: "Soap-free cleansing base at pH 5.5 with Panthenol and Vitamin E",
    form: DosageForm.SOAP, packSize: "bar of 150 g", hsn: "34011190", gst: 1800,
    mrp: 340, sp: 306, stock: 78,
    shortDescription: "Soap-free pH 5.5 cleansing bar for babies.",
    uses: "Gentle daily cleansing for a baby's skin.",
    howItWorks: "A soap-free base at pH 5.5, matched to the acid mantle of young skin.",
    sideEffects: "Rare local irritation.",
    warnings: "For external use only. Avoid the eye area.",
    directions: "Use with water during a bath, then rinse thoroughly.",
  },
  {
    name: "Pampers Premium Care Pants — Medium", brand: "Pampers", category: "diapers-wipes",
    manufacturer: "Procter & Gamble Hygiene and Health Care Ltd", scheduleType: ScheduleType.COSMETIC,
    composition: "Superabsorbent polymer core with cotton-like top sheet",
    form: DosageForm.OTHER, packSize: "pack of 54 pants (7-12 kg)", hsn: "96190010", gst: 1200,
    mrp: 899, sp: 764, stock: 62,
    shortDescription: "Pant-style diapers for 7-12 kg.",
    uses: "Daily and overnight diapering for babies weighing 7 to 12 kg.",
    howItWorks: "An absorbent polymer core locks liquid away from the surface layer that touches the skin.",
    sideEffects: "Occasional redness if left unchanged for long periods.",
    warnings: "Change regularly. Discard responsibly — do not flush.",
    directions: "Pull on, adjust the waistband, and change every three to four hours.",
  },
  {
    name: "Woodward's Gripe Water", brand: "Woodward's", category: "baby-bath-skin",
    manufacturer: "Zydus Wellness Ltd", scheduleType: ScheduleType.AYURVEDIC,
    composition: "Dill Oil 0.0021ml + Sodium Bicarbonate 5mg per 5ml",
    form: DosageForm.SOLUTION, packSize: "bottle of 130 ml", hsn: "30039011", gst: 1200,
    mrp: 105, sp: 96, stock: 140,
    salts: [{ name: "Dill Oil", strength: "0.0021 ml" }],
    shortDescription: "Traditional ayurvedic preparation with dill oil.",
    uses: "A traditional preparation given to infants for stomach comfort.",
    howItWorks: "A dill-oil preparation used traditionally in infant care.",
    sideEffects: "Generally well tolerated.",
    warnings: "Use on the advice of a paediatrician for infants under one month. Discard 30 days after opening.",
    directions: "As advised by a paediatrician.",
  },

  // --- Devices & diagnostics -------------------------------------------------
  {
    name: "Omron HEM-7124 Digital Blood Pressure Monitor", brand: "Omron", category: "monitoring-devices",
    manufacturer: "Omron Healthcare India Pvt Ltd", scheduleType: ScheduleType.DEVICE,
    composition: "Oscillometric automatic upper-arm blood pressure monitor",
    form: DosageForm.DEVICE, packSize: "1 unit with cuff and adapter", hsn: "90183090", gst: 1200,
    mrp: 2350, sp: 1975, stock: 22,
    shortDescription: "Clinically validated upper-arm BP monitor.",
    uses: "Home measurement of systolic and diastolic blood pressure and pulse rate.",
    howItWorks: "The cuff inflates and the device reads the oscillations in cuff pressure caused by each pulse, converting them into a blood pressure reading.",
    sideEffects: "Temporary arm discomfort during inflation.",
    warnings: "Home readings supplement but do not replace clinical assessment. Discuss unusual readings with your doctor rather than adjusting medication yourself.",
    directions: "Sit still with the cuff at heart level, feet flat, and rest for five minutes before measuring.",
  },
  {
    name: "Accu-Chek Active Blood Glucose Monitor", brand: "Accu-Chek", category: "monitoring-devices",
    manufacturer: "Roche Diabetes Care India Pvt Ltd", scheduleType: ScheduleType.DEVICE,
    composition: "Photometric blood glucose meter with lancing device",
    form: DosageForm.DEVICE, packSize: "1 kit with 10 strips and 10 lancets", hsn: "90183900",
    gst: 1200, mrp: 1899, sp: 1520, stock: 28,
    shortDescription: "Blood glucose meter kit with starter strips.",
    uses: "Home monitoring of blood glucose.",
    howItWorks: "A drop of blood on the test strip reacts with an enzyme; the meter reads the resulting colour change and converts it into a glucose value.",
    sideEffects: "Momentary discomfort at the lancing site.",
    warnings: "Use only Accu-Chek Active strips. Check the strip expiry date. Never adjust insulin doses without medical advice.",
    directions: "Insert a strip, lance the side of a fingertip, and apply the blood drop to the strip.",
  },
  {
    name: "Accu-Chek Active Test Strips", brand: "Accu-Chek", category: "test-strips-consumables",
    manufacturer: "Roche Diabetes Care India Pvt Ltd", scheduleType: ScheduleType.DEVICE,
    composition: "Glucose oxidase test strips for the Accu-Chek Active meter",
    form: DosageForm.DEVICE, packSize: "vial of 50 strips", hsn: "38220090", gst: 1200,
    mrp: 1150, sp: 985, stock: 54,
    shortDescription: "Replacement test strips, pack of 50.",
    uses: "Consumable test strips for use with the Accu-Chek Active meter.",
    howItWorks: "An enzyme on the strip reacts with glucose in the blood sample, producing a colour change the meter measures.",
    sideEffects: "Not applicable.",
    warnings: "Compatible only with Accu-Chek Active meters. Close the vial immediately after removing a strip — humidity degrades them. Do not use after the expiry date.",
    directions: "Insert one strip into the meter and apply the blood sample as prompted.",
  },
  {
    name: "Dr Morepen Pulse Oximeter PO-12A", brand: "Dr Morepen", category: "monitoring-devices",
    manufacturer: "Morepen Laboratories Ltd", scheduleType: ScheduleType.DEVICE,
    composition: "Fingertip pulse oximeter with OLED display",
    form: DosageForm.DEVICE, packSize: "1 unit with lanyard and batteries", hsn: "90181910",
    gst: 1200, mrp: 1550, sp: 1085, stock: 40,
    shortDescription: "Fingertip pulse oximeter.",
    uses: "Spot measurement of blood oxygen saturation and pulse rate.",
    howItWorks: "Two wavelengths of light pass through the fingertip; the ratio absorbed indicates how saturated the haemoglobin is with oxygen.",
    sideEffects: "Not applicable.",
    warnings: "Nail polish, cold fingers and poor circulation affect accuracy. Seek medical advice for persistently low readings rather than repeating the measurement.",
    directions: "Clip onto a clean, warm fingertip and stay still until the reading stabilises.",
  },
  {
    name: "Romsons Digital Thermometer", brand: "Romsons", category: "monitoring-devices",
    manufacturer: "Romsons Scientific & Surgical Pvt Ltd", scheduleType: ScheduleType.DEVICE,
    composition: "Digital clinical thermometer with flexible tip",
    form: DosageForm.DEVICE, packSize: "1 unit", hsn: "90251110", gst: 1200,
    mrp: 235, sp: 178, stock: 120,
    shortDescription: "Flexible-tip digital clinical thermometer.",
    uses: "Measurement of body temperature, orally or under the arm.",
    howItWorks: "A thermistor at the tip changes resistance with temperature; the device converts this to a reading and beeps when stable.",
    sideEffects: "Not applicable.",
    warnings: "Clean with an alcohol swab before and after each use. Under-arm readings run slightly lower than oral.",
    directions: "Switch on, place, and wait for the beep.",
  },
  {
    name: "Dr Trust Compressor Nebulizer", brand: "Dr Trust", category: "monitoring-devices",
    manufacturer: "Morepen Laboratories Ltd", scheduleType: ScheduleType.DEVICE,
    composition: "Piston compressor nebulizer with adult and child masks",
    form: DosageForm.DEVICE, packSize: "1 unit with masks, tubing and medicine cup",
    hsn: "90192090", gst: 1200, mrp: 2450, sp: 1840, stock: 18,
    shortDescription: "Compressor nebulizer with adult and paediatric masks.",
    uses: "Delivery of prescribed inhaled medication as a fine mist.",
    howItWorks: "A piston compressor forces air through the medicine cup, breaking the liquid into droplets small enough to be inhaled.",
    sideEffects: "Not applicable to the device itself.",
    warnings: "Use only medication prescribed for nebulisation. Clean and dry the cup, mask and tubing after every use.",
    directions: "Add the prescribed dose to the medicine cup, fit the mask, and run until the mist stops.",
  },

  // --- Personal care ---------------------------------------------------------
  {
    name: "Sensodyne Rapid Relief Toothpaste", brand: "Sensodyne", category: "oral-care",
    manufacturer: "Haleon India", scheduleType: ScheduleType.COSMETIC,
    composition: "Stannous Fluoride 0.454% w/w", form: DosageForm.OTHER,
    packSize: "tube of 80 g", hsn: "33061020", gst: 1800, mrp: 195, sp: 176, stock: 160,
    shortDescription: "Daily toothpaste for sensitive teeth.",
    uses: "Daily brushing for teeth that feel sensitive to cold or sweet foods.",
    howItWorks: "Stannous fluoride forms a protective layer over exposed areas of the tooth surface.",
    sideEffects: "Occasional surface staining with prolonged use.",
    warnings: "For external use in the mouth only. Not for children under 12 unless advised by a dentist. Do not swallow.",
    directions: "Brush twice daily for two minutes.",
  },
  {
    name: "Dettol Antiseptic Liquid", brand: "Dettol", category: "antiseptics-first-aid",
    manufacturer: "Reckitt Benckiser (India) Pvt Ltd", scheduleType: ScheduleType.OTC,
    composition: "Chloroxylenol 4.8% w/v", strength: "4.8% w/v", form: DosageForm.SOLUTION,
    packSize: "bottle of 550 ml", hsn: "38089400", gst: 1800, mrp: 285, sp: 258, stock: 175,
    salts: [{ name: "Chloroxylenol", strength: "4.8% w/v" }],
    shortDescription: "Antiseptic disinfectant liquid.",
    uses: "Antiseptic for minor cuts and grazes, and general surface and laundry disinfection.",
    howItWorks: "Chloroxylenol disrupts the cell membranes of a broad range of bacteria.",
    sideEffects: "Skin irritation if used undiluted.",
    warnings: "Always dilute before applying to skin. For external use only. Keep away from the eyes.",
    directions: "Dilute one capful in half a litre of water for antiseptic use.",
  },
  {
    name: "Savlon Antiseptic Liquid", brand: "Savlon", category: "antiseptics-first-aid",
    manufacturer: "Hindustan Unilever Ltd", scheduleType: ScheduleType.OTC,
    composition: "Cetrimide 3% w/v + Chlorhexidine Gluconate 1.5% w/v", form: DosageForm.SOLUTION,
    packSize: "bottle of 500 ml", hsn: "38089400", gst: 1800, mrp: 265, sp: 238, stock: 150,
    salts: [{ name: "Cetrimide", strength: "3% w/v" }, { name: "Chlorhexidine Gluconate", strength: "1.5% w/v" }],
    shortDescription: "Antiseptic liquid for wound cleansing.",
    uses: "Cleansing of minor wounds, cuts and abrasions.",
    howItWorks: "Cetrimide lifts debris from the wound while chlorhexidine acts against bacteria on the surface.",
    sideEffects: "Local stinging on open wounds.",
    warnings: "For external use only. Dilute as directed. Avoid the eyes and ears.",
    directions: "Dilute as directed on the label and apply with clean cotton.",
  },

  // --- Generic alternatives --------------------------------------------------
  //
  // These exist so the salt-substitutes panel has something real to show. Each
  // one shares an EXACT salt fingerprint with a product above — same molecule,
  // same strength — which is the only basis on which this platform will offer a
  // substitution. Indian retail genuinely carries a dozen brands per molecule at
  // widely different prices, and a catalogue that hides that is working against
  // the customer.
  {
    name: "Calpol 500mg Tablet", brand: "Calpol", category: "pain-relief-fever",
    manufacturer: "GlaxoSmithKline Pharmaceuticals Ltd", scheduleType: ScheduleType.OTC,
    composition: "Paracetamol 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 30, sp: 26.5, stock: 190,
    salts: [{ name: "Paracetamol", strength: "500 mg" }],
    shortDescription: "Paracetamol tablet for fever and pain.",
    uses: "Reduces fever and relieves mild to moderate pain.",
    howItWorks: "Paracetamol acts centrally to raise the pain threshold and lower the body's temperature set point.",
    sideEffects: "Uncommon at recommended doses.",
    warnings: "Do not exceed 4 g of paracetamol in 24 hours from all sources.",
    directions: "One tablet every 4 to 6 hours as needed, with or after food.",
  },
  {
    name: "Pacimol 500mg Tablet", brand: "Pacimol", category: "pain-relief-fever",
    manufacturer: "Ipca Laboratories Ltd", scheduleType: ScheduleType.OTC,
    composition: "Paracetamol 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 25, sp: 21.5, stock: 220,
    salts: [{ name: "Paracetamol", strength: "500 mg" }],
    shortDescription: "Paracetamol tablet for fever and pain.",
    uses: "Reduces fever and relieves mild to moderate pain.",
    howItWorks: "Paracetamol raises the pain threshold and helps the body lower its temperature set point.",
    sideEffects: "Uncommon at recommended doses.",
    warnings: "Do not exceed 4 g of paracetamol in 24 hours from all sources.",
    directions: "One tablet every 4 to 6 hours as needed, after food.",
  },
  {
    name: "Paracip 500mg Tablet", brand: "Paracip", category: "pain-relief-fever",
    manufacturer: "Cipla Ltd", scheduleType: ScheduleType.OTC,
    composition: "Paracetamol 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 22, sp: 18.9, stock: 260,
    salts: [{ name: "Paracetamol", strength: "500 mg" }],
    shortDescription: "Economical paracetamol tablet.",
    uses: "Reduces fever and relieves mild to moderate pain.",
    howItWorks: "Paracetamol raises the pain threshold and helps the body lower its temperature set point.",
    sideEffects: "Uncommon at recommended doses.",
    warnings: "Do not exceed 4 g of paracetamol in 24 hours from all sources.",
    directions: "One tablet every 4 to 6 hours as needed, after food.",
  },
  {
    name: "Amlopres 5 Tablet", brand: "Amlopres", category: "heart-blood-pressure",
    manufacturer: "Cipla Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Amlodipine 5mg", strength: "5 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 68, sp: 59, stock: 120,
    salts: [{ name: "Amlodipine", strength: "5 mg" }],
    shortDescription: "Calcium channel blocker for blood pressure.",
    uses: "High blood pressure and stable angina.",
    howItWorks: "Amlodipine relaxes the smooth muscle in artery walls, lowering the resistance the heart pumps against.",
    sideEffects: "Ankle swelling, flushing, headache.",
    warnings: "Do not stop suddenly without medical advice.",
    directions: "One tablet once daily.",
  },
  {
    name: "Stamlo 5 Tablet", brand: "Stamlo", category: "heart-blood-pressure",
    manufacturer: "Dr Reddy's Laboratories Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Amlodipine 5mg", strength: "5 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 58, sp: 49.5, stock: 135,
    salts: [{ name: "Amlodipine", strength: "5 mg" }],
    shortDescription: "Calcium channel blocker for blood pressure.",
    uses: "High blood pressure and stable angina.",
    howItWorks: "Amlodipine relaxes artery walls so blood flows with less resistance.",
    sideEffects: "Ankle swelling, flushing, headache.",
    warnings: "Do not stop suddenly without medical advice.",
    directions: "One tablet once daily.",
  },
  {
    name: "Pantocid 40 Tablet", brand: "Pantocid", category: "stomach-digestion",
    manufacturer: "Sun Pharmaceutical Industries Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Pantoprazole 40mg", strength: "40 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 158, sp: 136, stock: 105,
    salts: [{ name: "Pantoprazole", strength: "40 mg" }],
    shortDescription: "Proton pump inhibitor for acid reduction.",
    uses: "Acid reflux, gastric and duodenal ulcer.",
    howItWorks: "Pantoprazole shuts down the proton pumps in the stomach lining that produce acid.",
    sideEffects: "Headache, diarrhoea, flatulence.",
    warnings: "Take before food. Review long-term use with your doctor.",
    directions: "One tablet daily, 30 to 60 minutes before breakfast.",
  },
  {
    name: "Pantop 40 Tablet", brand: "Pantop", category: "stomach-digestion",
    manufacturer: "Aristo Pharmaceuticals Pvt Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Pantoprazole 40mg", strength: "40 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 132, sp: 112, stock: 118,
    salts: [{ name: "Pantoprazole", strength: "40 mg" }],
    shortDescription: "Proton pump inhibitor for acid reduction.",
    uses: "Acid reflux, gastric and duodenal ulcer.",
    howItWorks: "Pantoprazole blocks the final step of acid secretion in the stomach lining.",
    sideEffects: "Headache, diarrhoea, flatulence.",
    warnings: "Take before food. Review long-term use with your doctor.",
    directions: "One tablet daily before breakfast.",
  },
  {
    name: "Azee 500 Tablet", brand: "Azee", category: "antibiotics",
    manufacturer: "Cipla Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Azithromycin 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 5 tablets", hsn: "30042019", gst: 1200, mrp: 132, sp: 112, stock: 58,
    salts: [{ name: "Azithromycin", strength: "500 mg" }],
    shortDescription: "Macrolide antibiotic, once-daily dosing.",
    uses: "Bacterial infections of the throat, chest, skin and soft tissue.",
    howItWorks: "Azithromycin binds the bacterial ribosome and halts protein synthesis.",
    sideEffects: "Nausea, abdominal pain, diarrhoea.",
    warnings: "Complete the full course even if you feel better; stopping early promotes resistance.",
    directions: "One tablet daily at the same time each day, as prescribed.",
  },
  {
    name: "Zithrox 500 Tablet", brand: "Zithrox", category: "antibiotics",
    manufacturer: "Mankind Pharma Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Azithromycin 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 5 tablets", hsn: "30042019", gst: 1200, mrp: 115, sp: 96, stock: 64,
    salts: [{ name: "Azithromycin", strength: "500 mg" }],
    shortDescription: "Macrolide antibiotic, once-daily dosing.",
    uses: "Bacterial infections of the throat, chest and skin.",
    howItWorks: "Azithromycin stops bacteria multiplying by blocking their protein synthesis.",
    sideEffects: "Nausea, abdominal pain, diarrhoea.",
    warnings: "Complete the full prescribed course.",
    directions: "One tablet daily, as prescribed.",
  },
  {
    name: "Glyciphage 500 Tablet", brand: "Glyciphage", category: "diabetes-care",
    manufacturer: "Franco-Indian Pharmaceuticals Pvt Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Metformin Hydrochloride 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 20 tablets", hsn: "30049099", gst: 1200, mrp: 35, sp: 30, stock: 150,
    salts: [{ name: "Metformin", strength: "500 mg" }],
    shortDescription: "First-line oral antidiabetic.",
    uses: "Management of type 2 diabetes mellitus alongside diet and exercise.",
    howItWorks: "Metformin reduces glucose production by the liver and improves insulin sensitivity.",
    sideEffects: "Nausea, metallic taste, loose stools, usually settling after the first weeks.",
    warnings: "Tell your doctor before any scan involving contrast dye.",
    directions: "One tablet once or twice daily with meals, as prescribed.",
  },
  {
    name: "Okamet 500 Tablet", brand: "Okamet", category: "diabetes-care",
    manufacturer: "Cipla Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Metformin Hydrochloride 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 20 tablets", hsn: "30049099", gst: 1200, mrp: 40, sp: 34.5, stock: 140,
    salts: [{ name: "Metformin", strength: "500 mg" }],
    shortDescription: "First-line oral antidiabetic.",
    uses: "Management of type 2 diabetes mellitus.",
    howItWorks: "Metformin lowers hepatic glucose output and improves the body's response to insulin.",
    sideEffects: "Nausea, metallic taste, loose stools.",
    warnings: "Stop and seek advice during severe dehydration or acute illness.",
    directions: "One tablet once or twice daily with meals.",
  },
  {
    name: "Telsartan 40 Tablet", brand: "Telsartan", category: "heart-blood-pressure",
    manufacturer: "Dr Reddy's Laboratories Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Telmisartan 40mg", strength: "40 mg", form: DosageForm.TABLET,
    packSize: "strip of 15 tablets", hsn: "30049099", gst: 1200, mrp: 155, sp: 132, stock: 98,
    salts: [{ name: "Telmisartan", strength: "40 mg" }],
    shortDescription: "Angiotensin receptor blocker for blood pressure.",
    uses: "High blood pressure and cardiovascular risk reduction.",
    howItWorks: "Telmisartan blocks the receptor angiotensin II acts on, allowing blood vessels to relax.",
    sideEffects: "Dizziness on standing, back pain, raised potassium.",
    warnings: "Not to be used in pregnancy.",
    directions: "One tablet once daily.",
  },
  {
    name: "Alerid 10mg Tablet", brand: "Alerid", category: "cold-cough-allergy",
    manufacturer: "Cipla Ltd", scheduleType: ScheduleType.OTC,
    composition: "Cetirizine Hydrochloride 10mg", strength: "10 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30049099", gst: 1200, mrp: 45, sp: 38.5, stock: 170,
    salts: [{ name: "Cetirizine", strength: "10 mg" }],
    shortDescription: "Once-daily antihistamine.",
    uses: "Relief of sneezing, runny nose, itchy eyes and hives.",
    howItWorks: "Cetirizine blocks histamine H1 receptors, damping the allergic response.",
    sideEffects: "Drowsiness, dry mouth.",
    warnings: "May cause drowsiness. Do not drive until you know how it affects you.",
    directions: "One tablet at night.",
  },
  {
    name: "Rozavel 10 Tablet", brand: "Rozavel", category: "heart-blood-pressure",
    manufacturer: "Sun Pharmaceutical Industries Ltd", scheduleType: ScheduleType.SCHEDULE_H,
    composition: "Rosuvastatin 10mg", strength: "10 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30049099", gst: 1200, mrp: 175, sp: 152, stock: 88,
    salts: [{ name: "Rosuvastatin", strength: "10 mg" }],
    shortDescription: "Statin for cholesterol management.",
    uses: "Elevated cholesterol and cardiovascular risk reduction.",
    howItWorks: "Rosuvastatin inhibits the liver enzyme used to make cholesterol and increases clearance of LDL.",
    sideEffects: "Muscle aches, headache, nausea.",
    warnings: "Report unexplained muscle pain or weakness promptly. Not for use in pregnancy.",
    directions: "One tablet once daily, usually in the evening.",
  },
  {
    name: "Taxim-O 200 Tablet", brand: "Taxim-O", category: "antibiotics",
    manufacturer: "Alkem Laboratories Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Cefixime 200mg", strength: "200 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30042019", gst: 1200, mrp: 195, sp: 168, stock: 36,
    salts: [{ name: "Cefixime", strength: "200 mg" }],
    shortDescription: "Third-generation cephalosporin. Schedule H1.",
    uses: "Urinary tract infections, throat infections, bronchitis and typhoid fever.",
    howItWorks: "Cefixime interferes with bacterial cell wall construction, causing the cell to break down.",
    sideEffects: "Diarrhoea, nausea, abdominal pain, rash.",
    warnings: "Schedule H1 drug. Supply is recorded in a statutory register with the prescriber's details. Complete the full course.",
    directions: "One tablet every 12 hours after food, as prescribed.",
  },
  {
    name: "Mahacef 200 Tablet", brand: "Mahacef", category: "antibiotics",
    manufacturer: "Mankind Pharma Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Cefixime 200mg", strength: "200 mg", form: DosageForm.TABLET,
    packSize: "strip of 10 tablets", hsn: "30042019", gst: 1200, mrp: 168, sp: 142, stock: 40,
    salts: [{ name: "Cefixime", strength: "200 mg" }],
    shortDescription: "Third-generation cephalosporin. Schedule H1.",
    uses: "Urinary tract infections, throat infections and bronchitis.",
    howItWorks: "Cefixime disrupts the synthesis of the bacterial cell wall.",
    sideEffects: "Diarrhoea, nausea, abdominal pain.",
    warnings: "Schedule H1 drug, recorded in a statutory register. Complete the full course; do not keep leftovers for later use.",
    directions: "One tablet every 12 hours after food, as prescribed.",
  },
  {
    name: "Levoday 500 Tablet", brand: "Levoday", category: "antibiotics",
    manufacturer: "Micro Labs Ltd", scheduleType: ScheduleType.SCHEDULE_H1,
    composition: "Levofloxacin 500mg", strength: "500 mg", form: DosageForm.TABLET,
    packSize: "strip of 5 tablets", hsn: "30042019", gst: 1200, mrp: 150, sp: 128, stock: 34,
    salts: [{ name: "Levofloxacin", strength: "500 mg" }],
    shortDescription: "Fluoroquinolone antibiotic. Schedule H1.",
    uses: "Pneumonia, sinusitis, urinary tract infections and skin infections.",
    howItWorks: "Levofloxacin inhibits bacterial DNA gyrase, preventing the bacteria from replicating.",
    sideEffects: "Nausea, headache, dizziness. Rarely tendon pain.",
    warnings: "Schedule H1 drug, recorded in a statutory register. Stop and seek advice if you develop tendon pain.",
    directions: "One tablet daily, apart from antacids or iron supplements.",
  },
];

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function main() {
  console.log("Seeding Ashirwad Wellness…\n");

  // Order matters: the banned-substance trigger reads this table on every
  // product write, so it must be populated before any product is inserted.
  console.log("  banned substances");
  for (const b of BANNED_SUBSTANCES) {
    await db.bannedSubstance.upsert({
      where: { name: b.name },
      update: { reason: b.reason, authority: b.authority },
      create: b,
    });
  }

  console.log("  serviceable pincodes");
  for (const p of PINCODES) {
    await db.serviceablePincode.upsert({
      where: { pincode: p.pincode },
      update: {},
      create: {
        pincode: p.pincode,
        city: p.city,
        state: "Maharashtra",
        codAvailable: p.codAvailable ?? true,
        etaHours: p.etaHours ?? 48,
      },
    });
  }

  console.log("  categories");
  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const parent = await db.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { name: c.name, slug: c.slug },
    });
    categoryIds.set(c.slug, parent.id);

    for (const child of c.children ?? []) {
      const sub = await db.category.upsert({
        where: { slug: child.slug },
        update: {},
        create: { name: child.name, slug: child.slug, parentId: parent.id },
      });
      categoryIds.set(child.slug, sub.id);
    }
  }

  console.log("  manufacturers");
  const manufacturerIds = new Map<string, string>();
  for (const name of MANUFACTURERS) {
    const m = await db.manufacturer.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
    manufacturerIds.set(name, m.id);
  }

  console.log("  brands");
  const brandIds = new Map<string, string>();
  for (const name of [...new Set(PRODUCTS.map((p) => p.brand))]) {
    const b = await db.brand.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
    brandIds.set(name, b.id);
  }

  console.log("  salts");
  const saltIds = new Map<string, string>();
  const allSalts = [
    ...new Set(PRODUCTS.flatMap((p) => p.salts ?? []).map((s) => s.name)),
  ];
  for (const name of allSalts) {
    const s = await db.salt.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
    saltIds.set(name, s.id);
  }

  console.log("  users");
  const passwordHash = await bcrypt.hash("Ashirwad@2026", 12);
  const users = [
    {
      email: "admin@ashirwadwellness.in",
      name: "Ashirwad Administrator",
      role: Role.ADMIN,
      pharmacistRegNo: null as string | null,
    },
    {
      email: "pharmacist@ashirwadwellness.in",
      name: "Registered Pharmacist (placeholder)",
      role: Role.PHARMACIST,
      // Deliberately a placeholder: this is stamped onto the statutory H1
      // register, so it must be replaced with the real MSPC number before use.
      pharmacistRegNo: "REPLACE_ME_MSPC_REGISTRATION_NO",
    },
    {
      email: "customer@example.invalid",
      name: "Test Customer",
      role: Role.CUSTOMER,
      pharmacistRegNo: null,
    },
  ];

  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: { role: u.role, pharmacistRegNo: u.pharmacistRegNo },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        pharmacistRegNo: u.pharmacistRegNo,
        passwordHash,
        emailVerified: new Date(),
      },
    });
  }

  console.log("  products");
  let rxCount = 0;
  let h1Count = 0;

  for (const p of PRODUCTS) {
    const slug = slugify(p.name);
    const categoryId = categoryIds.get(p.category);
    const manufacturerId = manufacturerIds.get(p.manufacturer);
    if (!categoryId) throw new Error(`Unknown category "${p.category}" for ${p.name}`);
    if (!manufacturerId) throw new Error(`Unknown manufacturer "${p.manufacturer}" for ${p.name}`);

    const isRx =
      p.scheduleType === ScheduleType.SCHEDULE_H ||
      p.scheduleType === ScheduleType.SCHEDULE_H1;
    if (isRx) rxCount++;
    if (p.scheduleType === ScheduleType.SCHEDULE_H1) h1Count++;

    const data = {
      name: p.name,
      slug,
      nameHi: p.nameHi ?? null,
      brandId: brandIds.get(p.brand)!,
      categoryId,
      manufacturerId,
      scheduleType: p.scheduleType,
      // Derived, never asserted independently — and the CHECK constraint will
      // reject this row if the derivation is ever wrong.
      requiresPrescription: isRx,
      saltKey: p.salts?.length ? saltKeyOf(p.salts) : null,
      composition: p.composition,
      strength: p.strength ?? null,
      form: p.form,
      packSize: p.packSize,
      hsnCode: p.hsn,
      gstRateBps: p.gst,
      mrpPaise: rs(p.mrp),
      sellingPricePaise: rs(p.sp),
      stock: p.stock,
      images: [`/products/${slug}.jpg`],
      shortDescription: p.shortDescription ?? null,
      uses: p.uses ?? null,
      howItWorks: p.howItWorks ?? null,
      sideEffects: p.sideEffects ?? null,
      storage: p.storage ?? STORE_COOL,
      warnings: p.warnings ?? null,
      directions: p.directions ?? null,
      expiryPolicy:
        "Dispensed with a minimum of 6 months remaining shelf life unless stated otherwise on the product page.",
      isRefrigerated: p.refrigerated ?? false,
      isReturnable: !isRx && p.scheduleType !== ScheduleType.DEVICE ? false : false,
    };

    const product = await db.product.upsert({
      where: { slug },
      update: data,
      create: data,
    });

    if (p.salts?.length) {
      await db.productSalt.deleteMany({ where: { productId: product.id } });
      for (const s of p.salts) {
        await db.productSalt.create({
          data: {
            productId: product.id,
            saltId: saltIds.get(s.name)!,
            strength: s.strength,
          },
        });
      }
    }
  }

  console.log("  coupons");
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const coupons = [
    {
      code: "FIRSTORDER",
      description: "15% off your first order, up to ₹150. Non-prescription items only.",
      percentOff: 15,
      maxDiscountPaise: rs(150),
      minOrderPaise: rs(499),
      perUserLimit: 1,
    },
    {
      code: "WELLNESS100",
      description: "₹100 off orders above ₹999 on vitamins, ayurveda and personal care.",
      flatOffPaise: rs(100),
      minOrderPaise: rs(999),
      perUserLimit: 3,
    },
    {
      code: "NASHIK10",
      description: "10% off for Nashik customers, up to ₹200. Non-prescription items only.",
      percentOff: 10,
      maxDiscountPaise: rs(200),
      minOrderPaise: rs(299),
      perUserLimit: 5,
    },
  ];

  for (const c of coupons) {
    await db.coupon.upsert({
      where: { code: c.code },
      update: {},
      create: {
        ...c,
        startsAt: now,
        endsAt: in90Days,
        // Prescription medicines are excluded from discounting by default.
        appliesToRxItems: false,
      },
    });
  }

  const total = await db.product.count();
  console.log(`
Seed complete.
  products            ${total}   (${rxCount} prescription-only, of which ${h1Count} Schedule H1)
  categories          ${categoryIds.size}
  manufacturers       ${manufacturerIds.size}
  brands              ${brandIds.size}
  salts               ${saltIds.size}
  banned substances   ${BANNED_SUBSTANCES.length}
  pincodes            ${PINCODES.length}   (Nashik district only)

Sign-in for all seeded accounts: Ashirwad@2026
  admin@ashirwadwellness.in        ADMIN
  pharmacist@ashirwadwellness.in   PHARMACIST
  customer@example.invalid         CUSTOMER
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
