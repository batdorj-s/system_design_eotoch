/**
 * Оффлайн горим: сервер холбогдохгүй үед ONNX загваруудыг браузер дотор ажиллуулна.
 * Шинжийн хөрвүүлэлт нь backend/app/ml/features.py-тай яг ижил байх ёстой.
 * (SHAP тайлбар зөвхөн сервер талд — энд гол хүчин зүйлсийг дүрмээр харуулна.)
 */
import type { Answers, DiseaseRisk, RiskResult } from "./types";
import { levelOf } from "./format";

type Vec = Record<string, number>;
interface Manifest {
  version: string;
  models: Record<string, { path: string; features: string[]; multiclass: boolean; prior: { train: number; population: number } | null }>;
}

const HEART_OR: Record<string, [number, string]> = {
  lifestyle_smoking: [2.0, "Тамхидалт"],
  lifestyle_salt: [1.3, "Давсны өндөр хэрэглээ"],
  lifestyle_alcohol: [1.3, "Архины тогтмол хэрэглээ"],
  lifestyle_inactive: [1.3, "Хөдөлгөөний дутагдал"],
  lifestyle_diet: [1.2, "Жимс ногоо бага"],
  lifestyle_family: [1.5, "Гэр бүлийн зүрхний өвчин"],
  lifestyle_obesity: [1.4, "Таргалалт (BMI ≥ 30)"],
};
const logit = (p: number) => {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(q / (1 - q));
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export const bmiOf = (a: Pick<Answers, "height" | "weight">) => a.weight / (a.height / 100) ** 2;

function heartVec(a: Answers): Vec {
  return {
    age: a.age,
    male: a.gender === "male" ? 1 : 0,
    chol: ({ normal: 190, borderline: 220, high: 260 } as Record<string, number>)[a.cholesterol] ?? NaN,
    fbs: ({ normal: 0, high: 1 } as Record<string, number>)[a.blood_sugar] ?? NaN,
    exang: a.symptoms.includes("chest_pain") ? 1 : 0,
  };
}

function cancerVec(a: Answers): Vec {
  const s = (n: string) => (a.symptoms.includes(n) ? 7 : 2);
  const bmi = bmiOf(a);
  const air = Math.min(Math.max(a.air_pollution, 1), 10);
  return {
    Age: a.age,
    Gender: a.gender === "male" ? 1 : 2,
    "Air Pollution": Math.round(1 + ((air - 1) * 7) / 9),
    "Alcohol use": { never: 1, seldom: 3, often: 6, daily: 8 }[a.alcohol_freq] ?? 2,
    "Genetic Risk": a.family_history.includes("cancer") ? 6 : 2,
    Smoking: { never: 1, former: 4, current: 7 }[a.smoking] ?? 1,
    Obesity: bmi < 25 ? 2 : bmi < 30 ? 4 : 6,
    "Balanced Diet": { daily: 2, some: 4, rare: 6 }[a.fruit_veg] ?? 4,
    "Chest Pain": s("chest_pain"),
    "Coughing of Blood": s("coughing_blood"),
    "Shortness of Breath": s("short_breath"),
    Fatigue: s("fatigue"),
    "Weight Loss": s("weight_loss"),
    "Swallowing Difficulty": s("swallow_diff"),
  };
}

function diabetesVec(a: Answers): Vec {
  // CDC BRFSS шинжүүд (backend/app/ml/features.py: diabetes_vector)
  const ageCat = a.age < 25 ? 1 : Math.min(13, 2 + Math.floor((a.age - 25) / 5));
  return {
    age_cat: ageCat,
    male: a.gender === "male" ? 1 : 0,
    bmi: bmiOf(a),
    high_bp: a.bp_systolic >= 140 ? 1 : 0,
    high_chol: ({ high: 1, normal: 0, borderline: 0 } as Record<string, number>)[a.cholesterol] ?? NaN,
    ever_smoker: a.smoking === "never" ? 0 : 1,
    inactive: a.activity === "low" ? 1 : 0,
    no_fruits: a.fruit_veg === "daily" ? 0 : 1,
    no_veggies: a.fruit_veg === "rare" ? 1 : 0,
  };
}

/** Prior shift + хэвлэгдсэн OR-ууд (backend RiskEngine._adjusted-тэй ижил) */
function adjust(p: number, prior: { train: number; population: number } | null, steps: [string, number][]) {
  let z = prior ? logit(p) - logit(prior.train) + logit(prior.population) : logit(p);
  const factors: { label: string; impact: number }[] = [];
  for (const [label, lo] of steps) {
    const before = sigmoid(z);
    z += lo;
    factors.push({ label, impact: Math.round((sigmoid(z) - before) * 1000) / 10 });
  }
  return { risk: sigmoid(z), factors };
}

let manifestP: Promise<Manifest> | null = null;
const sessions: Record<string, Promise<import("onnxruntime-web/wasm").InferenceSession>> = {};
let ortP: Promise<typeof import("onnxruntime-web/wasm")> | null = null;

/** WASM (CPU) хувилбарыг хоцрогдуулан ачаална; файлын замыг Vite-ээр шийднэ (dev болон build хоёуланд). */
function loadOrt() {
  ortP ??= Promise.all([
    import("onnxruntime-web/wasm"),
    import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url"),
    import("onnxruntime-web/ort-wasm-simd-threaded.mjs?url"),
  ]).then(([ort, wasm, mjs]) => {
    ort.env.wasm.wasmPaths = { wasm: wasm.default, mjs: mjs.default };
    ort.env.wasm.numThreads = 1; // cross-origin isolation шаардахгүй
    return ort;
  });
  return ortP;
}

async function run(key: string, vec: Vec): Promise<{ p: number; prior: Manifest["models"][string]["prior"] }> {
  const ort = await loadOrt();
  manifestP ??= fetch("/models/manifest.json").then((r) => r.json());
  const m = (await manifestP).models[key];
  sessions[key] ??= ort.InferenceSession.create(m.path);
  const sess = await sessions[key];
  const input = Float32Array.from(m.features.map((f) => vec[f]));
  const out = await sess.run({ float_input: new ort.Tensor("float32", input, [1, m.features.length]) });
  const p = out.probabilities.data as Float32Array;
  return { p: m.multiclass ? p[2] + 0.5 * p[1] : p[1], prior: m.prior };
}

function disease(label: string, risk: number, factors: { label: string; impact: number }[], kind: DiseaseRisk["kind"]): DiseaseRisk {
  const value = Math.round(risk * 1000) / 10;
  const level = levelOf(value);
  return {
    label, value, baseline: 0, level, level_label: { low: "Бага", moderate: "Дунд", high: "Өндөр" }[level],
    factors: factors.map((f) => ({ feature: f.label, label: f.label, impact: f.impact, source: "odds_ratio" as const })),
    algorithm: "ONNX (оффлайн)", kind,
  };
}

export async function predictOffline(a: Answers): Promise<RiskResult> {
  const bmi = bmiOf(a);
  const cat = bmi < 18.5 ? "Жингийн дутагдалтай" : bmi < 25 ? "Хэвийн жинтэй" : bmi < 30 ? "Илүүдэл жинтэй" : "Таргалалттай";
  const redFlags: string[] = [];
  if (a.symptoms.includes("coughing_blood")) redFlags.push("Цустай ханиалга — яаралтай эмчид үзүүлнэ үү.");
  if (a.bp_systolic >= 180) redFlags.push(`Систолын даралт ${a.bp_systolic} ммМУБ — гипертензийн хямралын түвшин.`);
  if (a.symptoms.includes("chest_pain") && a.symptoms.includes("short_breath"))
    redFlags.push("Цээжний өвдөлт + амьсгаадалт — зүрхний яаралтай тусламж шаардлагатай байж болзошгүй.");
  const base: RiskResult = {
    model_version: "offline", bmi: Math.round(bmi * 10) / 10, bmi_category: { key: "", label: cat },
    in_scope: a.age >= 15 && a.age <= 65, red_flags: redFlags, urgent: redFlags.length > 0, offline: true,
  };
  if (!base.in_scope) return { ...base, scope_message: "Энэ насны хүрээнд хамаарахгүй (15–65). Эмчид хандана уу." };

  const [h, c, d] = await Promise.all([run("heart", heartVec(a)), run("cancer", cancerVec(a)), run("diabetes", diabetesVec(a))]);
  const flags: Record<string, boolean> = {
    lifestyle_smoking: a.smoking === "current", lifestyle_salt: a.salt_intake >= 8,
    lifestyle_alcohol: a.alcohol_freq === "daily", lifestyle_inactive: a.activity === "low",
    lifestyle_diet: a.fruit_veg === "rare", lifestyle_family: a.family_history.includes("heart"),
    lifestyle_obesity: bmi >= 30,
  };
  const heartSteps: [string, number][] = [];
  if (a.bp_systolic > 120) heartSteps.push(["Систолын даралт", (Math.log(1.5) * (a.bp_systolic - 120)) / 20]);
  for (const [k, on] of Object.entries(flags)) if (on) heartSteps.push([HEART_OR[k][1], Math.log(HEART_OR[k][0])]);
  const heart = adjust(h.p, h.prior ?? { train: 0.553, population: 0.15 }, heartSteps);
  const diabSteps: [string, number][] = [];
  if (a.family_history.includes("diabetes")) diabSteps.push(["Гэр бүлд чихрийн шижин", Math.log(2.3)]);
  if (a.symptoms.includes("thirst")) diabSteps.push(["Их цангах / шээх", Math.log(3.0)]);
  const diab = adjust(d.p, d.prior, diabSteps);
  const heartFactors = heart.factors;
  const risks = {
    heart: disease("Зүрх судас", heart.risk, heartFactors, "probability"),
    diabetes: disease("Чихрийн шижин", diab.risk, diab.factors, "probability"),
    cancer: disease("Хавдар (уушги)", c.p, [], "relative_index"),
  };
  const vals = Object.values(risks).map((r) => r.value);
  const overall = Math.round((0.6 * Math.max(...vals) + 0.4 * (vals.reduce((x, y) => x + y) / 3)) * 10) / 10;
  const lv = levelOf(overall);
  return {
    ...base, risks,
    overall: { value: overall, level: lv, level_label: { low: "Бага", moderate: "Дунд", high: "Өндөр" }[lv] },
    radar: [
      { axis: "Зүрх судас", value: risks.heart.value },
      { axis: "Чихрийн шижин", value: risks.diabetes.value },
      { axis: "Хавдар", value: risks.cancer.value },
      { axis: "Жин (BMI)", value: Math.min(100, Math.max(0, bmi >= 22 ? (bmi - 22) * 8 : (22 - bmi) * 10)) },
      { axis: "Амьдралын хэв маяг", value: Math.min(100, (a.smoking === "current" ? 30 : 0) + (a.activity === "low" ? 15 : 0) + Math.max(0, (a.salt_intake - 4) * 4)) },
    ],
    reasons: heartFactors.filter((f) => f.impact > 1).map((f) => `${f.label} → Зүрх судас эрсдэлийг +${f.impact}%`),
    specialties: [],
    urgent: base.urgent || risks.heart.value >= 85 || risks.cancer.value >= 85,
  };
}
