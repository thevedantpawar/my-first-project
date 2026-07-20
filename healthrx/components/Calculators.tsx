"use client";

import { useMemo, useState } from "react";
import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";

type Tab = "bmi" | "calorie" | "macro";
type Sex = "male" | "female";
type Goal = "lose" | "maintain" | "gain";

const activityLevels = [
  { key: "sedentary", label: "Sedentary", factor: 1.2, hint: "Little exercise" },
  { key: "light", label: "Light", factor: 1.375, hint: "1–3 days/wk" },
  { key: "moderate", label: "Moderate", factor: 1.55, hint: "3–5 days/wk" },
  { key: "active", label: "Active", factor: 1.725, hint: "6–7 days/wk" },
  { key: "athlete", label: "Athlete", factor: 1.9, hint: "2x/day" },
];

function bmiCategory(bmi: number) {
  if (bmi < 18.5) return { label: "Underweight", color: "#7dd3fc" };
  if (bmi < 25) return { label: "Healthy", color: "#B7FF00" };
  if (bmi < 30) return { label: "Overweight", color: "#fbbf24" };
  return { label: "Obese", color: "#fb7185" };
}

export function Calculators() {
  const [tab, setTab] = useState<Tab>("bmi");

  return (
    <section id="calculators" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 bg-[radial-gradient(45%_45%_at_80%_30%,rgba(183,255,0,0.08),transparent_60%)]" />
      <div className="shell relative">
        <SectionHeading
          eyebrow="Smart tools"
          title={
            <>
              Your instant <span className="text-lime">fitness calculators</span>
            </>
          }
          intro="Get science-based numbers in seconds — then let a coach turn them into a plan. BMI, daily calories and macro targets."
        />

        <Reveal delay={0.15}>
          <div className="glass mt-12 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-white/10">
              {(
                [
                  ["bmi", "BMI"],
                  ["calorie", "Calories"],
                  ["macro", "Macros"],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`relative flex-1 px-4 py-4 text-sm font-semibold transition-colors ${
                    tab === key ? "text-lime" : "text-white/50 hover:text-white"
                  }`}
                >
                  {label}
                  {tab === key && (
                    <span className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-lime" />
                  )}
                </button>
              ))}
            </div>

            <div className="p-6 sm:p-8">
              {tab === "bmi" && <BmiCalc />}
              {tab === "calorie" && <CalorieCalc />}
              {tab === "macro" && <MacroCalc />}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- shared inputs ---------- */

function Field({
  label,
  suffix,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  suffix?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/50">
        {label}
      </span>
      <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.03] focus-within:border-lime/50">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full bg-transparent px-4 py-3 text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && (
          <span className="pr-4 text-sm text-white/40">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            value === o.key
              ? "bg-lime text-ink"
              : "text-white/60 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- BMI ---------- */

function BmiCalc() {
  const [height, setHeight] = useState(172);
  const [weight, setWeight] = useState(74);

  const bmi = useMemo(() => {
    if (!height || !weight) return 0;
    const m = height / 100;
    return weight / (m * m);
  }, [height, weight]);

  const cat = bmiCategory(bmi || 0);
  // Position on a 15–40 BMI scale
  const pct = Math.max(0, Math.min(100, ((bmi - 15) / (40 - 15)) * 100));

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="space-y-5">
        <Field label="Height" suffix="cm" value={height} onChange={setHeight} min={100} max={230} />
        <Field label="Weight" suffix="kg" value={weight} onChange={setWeight} min={30} max={250} />
        <p className="text-xs leading-relaxed text-white/40">
          BMI is a quick screen, not a diagnosis. At HealthRx we pair it with
          body-composition testing for the full picture.
        </p>
      </div>

      <div className="flex flex-col justify-center rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <div className="text-xs uppercase tracking-wide text-white/50">
          Your BMI
        </div>
        <div
          className="mt-1 font-display text-6xl font-bold"
          style={{ color: cat.color }}
        >
          {bmi ? bmi.toFixed(1) : "—"}
        </div>
        <div className="mt-1 text-sm font-medium" style={{ color: cat.color }}>
          {bmi ? cat.label : "Enter your details"}
        </div>

        <div className="relative mt-6 h-2 rounded-full bg-gradient-to-r from-sky-400 via-lime to-rose-400">
          {bmi > 0 && (
            <span
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-white shadow"
              style={{ left: `${pct}%` }}
            />
          )}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-white/40">
          <span>15</span>
          <span>25</span>
          <span>40</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Calorie (TDEE) ---------- */

function useTdee() {
  const [sex, setSex] = useState<Sex>("male");
  const [age, setAge] = useState(30);
  const [height, setHeight] = useState(172);
  const [weight, setWeight] = useState(74);
  const [activity, setActivity] = useState("moderate");

  const { bmr, tdee } = useMemo(() => {
    if (!age || !height || !weight) return { bmr: 0, tdee: 0 };
    // Mifflin-St Jeor
    const base = 10 * weight + 6.25 * height - 5 * age;
    const bmr = sex === "male" ? base + 5 : base - 161;
    const factor =
      activityLevels.find((a) => a.key === activity)?.factor ?? 1.55;
    return { bmr: Math.round(bmr), tdee: Math.round(bmr * factor) };
  }, [sex, age, height, weight, activity]);

  return {
    sex, setSex, age, setAge, height, setHeight, weight, setWeight,
    activity, setActivity, bmr, tdee,
  };
}

function CalorieCalc() {
  const t = useTdee();
  const goals: { key: Goal; label: string; delta: number }[] = [
    { key: "lose", label: "Lose fat", delta: -0.2 },
    { key: "maintain", label: "Maintain", delta: 0 },
    { key: "gain", label: "Build", delta: 0.12 },
  ];

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="space-y-4">
        <Segmented
          value={t.sex}
          onChange={t.setSex}
          options={[
            { key: "male", label: "Male" },
            { key: "female", label: "Female" },
          ]}
        />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Age" suffix="yr" value={t.age} onChange={t.setAge} min={14} max={90} />
          <Field label="Height" suffix="cm" value={t.height} onChange={t.setHeight} min={100} max={230} />
          <Field label="Weight" suffix="kg" value={t.weight} onChange={t.setWeight} min={30} max={250} />
        </div>
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/50">
            Activity
          </span>
          <div className="grid grid-cols-1 gap-1.5">
            {activityLevels.map((a) => (
              <button
                key={a.key}
                onClick={() => t.setActivity(a.key)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                  t.activity === a.key
                    ? "border-lime/50 bg-lime/10 text-white"
                    : "border-white/10 text-white/60 hover:border-white/25"
                }`}
              >
                <span>{a.label}</span>
                <span className="text-xs text-white/40">{a.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-white/50">
            Maintenance calories
          </div>
          <div className="mt-1 font-display text-6xl font-bold text-lime">
            {t.tdee || "—"}
          </div>
          <div className="text-sm text-white/45">
            kcal/day · BMR {t.bmr || "—"}
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {goals.map((g) => (
            <div
              key={g.key}
              className="flex items-center justify-between rounded-lg bg-white/[0.03] px-4 py-2.5 text-sm"
            >
              <span className="text-white/60">{g.label}</span>
              <span className="font-display font-semibold text-white">
                {t.tdee ? Math.round(t.tdee * (1 + g.delta)) : "—"} kcal
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Macros ---------- */

function MacroCalc() {
  const t = useTdee();
  const [goal, setGoal] = useState<Goal>("maintain");

  const target = useMemo(() => {
    const delta = goal === "lose" ? -0.2 : goal === "gain" ? 0.12 : 0;
    return t.tdee ? Math.round(t.tdee * (1 + delta)) : 0;
  }, [t.tdee, goal]);

  // Split: protein 2g/kg, fat 25% kcal, carbs remainder
  const macros = useMemo(() => {
    if (!target || !t.weight) return null;
    const protein = Math.round(t.weight * 2);
    const proteinKcal = protein * 4;
    const fatKcal = target * 0.25;
    const fat = Math.round(fatKcal / 9);
    const carbKcal = Math.max(0, target - proteinKcal - fatKcal);
    const carbs = Math.round(carbKcal / 4);
    return { protein, fat, carbs, proteinKcal, fatKcal, carbKcal };
  }, [target, t.weight]);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="space-y-4">
        <Segmented
          value={t.sex}
          onChange={t.setSex}
          options={[
            { key: "male", label: "Male" },
            { key: "female", label: "Female" },
          ]}
        />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Age" suffix="yr" value={t.age} onChange={t.setAge} min={14} max={90} />
          <Field label="Height" suffix="cm" value={t.height} onChange={t.setHeight} min={100} max={230} />
          <Field label="Weight" suffix="kg" value={t.weight} onChange={t.setWeight} min={30} max={250} />
        </div>
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/50">
            Goal
          </span>
          <Segmented
            value={goal}
            onChange={setGoal}
            options={[
              { key: "lose", label: "Cut" },
              { key: "maintain", label: "Maintain" },
              { key: "gain", label: "Gain" },
            ]}
          />
        </div>
        <p className="text-xs leading-relaxed text-white/40">
          Based on 2g protein/kg and 25% of calories from fat. Your coach fine-tunes
          this to your labs and preferences.
        </p>
      </div>

      <div className="flex flex-col justify-center rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <div className="text-center text-sm text-white/50">
          Daily target ·{" "}
          <span className="font-semibold text-lime">{target || "—"} kcal</span>
        </div>

        {macros ? (
          <>
            <div className="mx-auto mt-5">
              <MacroRing macros={macros} total={target} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <MacroStat label="Protein" grams={macros.protein} color="#B7FF00" />
              <MacroStat label="Carbs" grams={macros.carbs} color="#7dd3fc" />
              <MacroStat label="Fat" grams={macros.fat} color="#fbbf24" />
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-sm text-white/40">
            Enter your details to see your split
          </div>
        )}
      </div>
    </div>
  );
}

function MacroStat({
  label,
  grams,
  color,
}: {
  label: string;
  grams: number;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-white/[0.03] py-3">
      <div className="mx-auto mb-1 h-1.5 w-8 rounded-full" style={{ background: color }} />
      <div className="font-display text-2xl font-bold">{grams}g</div>
      <div className="text-xs text-white/45">{label}</div>
    </div>
  );
}

function MacroRing({
  macros,
  total,
}: {
  macros: { proteinKcal: number; carbKcal: number; fatKcal: number };
  total: number;
}) {
  const p = (macros.proteinKcal / total) * 100;
  const c = (macros.carbKcal / total) * 100;
  const f = (macros.fatKcal / total) * 100;
  const bg = `conic-gradient(#B7FF00 0 ${p}%, #7dd3fc ${p}% ${p + c}%, #fbbf24 ${
    p + c
  }% 100%)`;

  return (
    <div
      className="relative flex h-40 w-40 items-center justify-center rounded-full"
      style={{ background: bg }}
    >
      <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-ink-card">
        <span className="font-display text-2xl font-bold">{total}</span>
        <span className="text-[10px] uppercase tracking-wide text-white/45">
          kcal
        </span>
      </div>
      <span className="sr-only">
        Protein {Math.round(p)}%, carbs {Math.round(c)}%, fat {Math.round(f)}%
      </span>
    </div>
  );
}
