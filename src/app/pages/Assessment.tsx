import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { predictOffline } from "../lib/offline";
import type { Answers } from "../lib/types";
import { ApiError, Answers as AnswersEntity, assessmentController } from "../domain";
import { BodyMap } from "../components/BodyMap";

const DEFAULTS: Answers = {
  age: 35, gender: "male", height: 170, weight: 70, bp_systolic: 120, smoking: "never", alcohol_freq: "never",
  salt_intake: 5, air_pollution: 5, activity: "moderate", fruit_veg: "some", cholesterol: "unknown",
  blood_sugar: "unknown", family_history: [], symptoms: [], body_parts: [], notes: "",
};

type Opt = { v: string; l: string; d?: string };

function Choice({ value, options, onChange, multi = false }: { value: string | string[]; options: Opt[]; onChange: (v: string) => void; multi?: boolean }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" role={multi ? "group" : "radiogroup"}>
      {options.map((o) => {
        const on = Array.isArray(value) ? value.includes(o.v) : value === o.v;
        return (
          <button key={o.v} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on} onClick={() => onChange(o.v)}
            className={`rounded-2xl border-2 px-4 py-3.5 text-left transition-all ${on ? "border-primary bg-secondary" : "border-border bg-white hover:border-primary/40"}`}>
            <span className="font-semibold">{o.l}</span>
            {o.d && <span className="mt-0.5 block text-sm text-muted-foreground">{o.d}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Range({ value, onChange, min, max, unit, hint }: { value: number; onChange: (n: number) => void; min: number; max: number; unit: string; hint?: ReactNode }) {
  // Бичих явцад хязгаарлахгүй (жишээ нь "8" → "85"), талбараас гарахад л хязгаарлана
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) onChange(Math.min(max, Math.max(min, Math.round(+draft) || min)));
    setDraft(null);
  };
  return (
    <div>
      <div className="flex items-end justify-center gap-2">
        <input type="number" inputMode="numeric" value={draft ?? value} min={min} max={max}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = +e.target.value;
            if (n >= min && n <= max) onChange(n);
          }}
          onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-32 rounded-xl border bg-white text-center font-display text-5xl font-extrabold outline-none focus:ring-2 focus:ring-primary/30" aria-label={unit} />
        <span className="pb-2 text-lg text-muted-foreground">{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className="mt-6 w-full accent-[var(--primary)]" />
      <div className="flex justify-between text-xs text-muted-foreground"><span>{min}</span><span>{max}</span></div>
      {hint && <div className="mt-4 rounded-xl bg-muted/60 p-3 text-sm">{hint}</div>}
    </div>
  );
}

export function Assessment() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [a, setA] = useState<Answers>(DEFAULTS);
  const [i, setI] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((p) => ({ ...p, [k]: v }));
  const toggle = (k: "family_history" | "symptoms", v: string) =>
    setA((p) => {
      if (v === "none") return { ...p, [k]: [] };
      const cur = p[k];
      return { ...p, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });
  const bmi = AnswersEntity.fromDTO(a).calcBMI();

  const steps = useMemo<{ section: string; q: string; help?: string; body: ReactNode }[]>(() => [
    { section: "Тантай танилцъя", q: "Таны нас?", help: "Загварууд 15–65 насны хүмүүст зориулагдсан.",
      body: <Range value={a.age} onChange={(n) => set("age", n)} min={15} max={100} unit="нас"
        hint={a.age > 65 ? "65-аас дээш насанд эрсдэлийн оноо тооцохгүй, зөвхөн зөвлөмж өгнө." : undefined} /> },
    { section: "Тантай танилцъя", q: "Таны хүйс?",
      body: <Choice value={a.gender} onChange={(v) => set("gender", v as Answers["gender"])} options={[{ v: "male", l: "Эрэгтэй" }, { v: "female", l: "Эмэгтэй" }]} /> },
    { section: "Биеийн үзүүлэлт", q: "Таны өндөр?",
      body: <Range value={a.height} onChange={(n) => set("height", n)} min={100} max={220} unit="см" /> },
    { section: "Биеийн үзүүлэлт", q: "Таны жин?",
      body: <Range value={a.weight} onChange={(n) => set("weight", n)} min={30} max={200} unit="кг"
        hint={<>BMI: <b>{bmi.toFixed(1)}</b> — {bmi < 18.5 ? "жингийн дутагдалтай" : bmi < 25 ? "хэвийн" : bmi < 30 ? "илүүдэл жинтэй" : "таргалалттай"}</>} /> },
    { section: "Биеийн үзүүлэлт", q: "Цусны даралтын дээд (систол) утга?", help: "Мэдэхгүй бол 120 гэж үлдээнэ үү. Хамгийн сүүлд хэмжүүлсэн утгаа оруулна.",
      body: <Range value={a.bp_systolic} onChange={(n) => set("bp_systolic", n)} min={80} max={220} unit="ммМУБ"
        hint={a.bp_systolic >= 180 ? <span className="font-semibold text-red-700">⚠️ Маш өндөр даралт. Толгой өвдөх, цээж өвдөх бол 103 руу залгана уу.</span> : a.bp_systolic >= 140 ? "140-өөс дээш бол даралт ихсэлтийн түвшин." : undefined} /> },
    { section: "Биеийн үзүүлэлт", q: "Цусан дахь холестерин, сахар?", help: "Шинжилгээний хариугаа мэдэхгүй бол “Мэдэхгүй” сонгоно уу.",
      body: <div className="space-y-5">
        <div><p className="mb-2 text-sm font-semibold">Холестерин</p>
          <Choice value={a.cholesterol} onChange={(v) => set("cholesterol", v as Answers["cholesterol"])} options={[{ v: "unknown", l: "Мэдэхгүй" }, { v: "normal", l: "Хэвийн", d: "< 5.2 ммоль/л" }, { v: "borderline", l: "Хил хязгаарт", d: "5.2–6.2" }, { v: "high", l: "Өндөр", d: "> 6.2" }]} /></div>
        <div><p className="mb-2 text-sm font-semibold">Өлөн үеийн сахар</p>
          <Choice value={a.blood_sugar} onChange={(v) => set("blood_sugar", v as Answers["blood_sugar"])} options={[{ v: "unknown", l: "Мэдэхгүй" }, { v: "normal", l: "Хэвийн" }, { v: "high", l: "Өндөр", d: "> 6.1 ммоль/л" }]} /></div>
      </div> },
    { section: "Амьдралын хэв маяг", q: "Та тамхи татдаг уу?",
      body: <Choice value={a.smoking} onChange={(v) => set("smoking", v as Answers["smoking"])} options={[{ v: "never", l: "Хэзээ ч татаагүй" }, { v: "former", l: "Өмнө нь татдаг байсан" }, { v: "current", l: "Одоо татдаг" }]} /> },
    { section: "Амьдралын хэв маяг", q: "Согтууруулах ундаа хэр хэрэглэдэг вэ?",
      body: <Choice value={a.alcohol_freq} onChange={(v) => set("alcohol_freq", v as Answers["alcohol_freq"])} options={[{ v: "never", l: "Хэрэглэдэггүй" }, { v: "seldom", l: "Сард 1–2 удаа" }, { v: "often", l: "Долоо хоногт хэд хэд" }, { v: "daily", l: "Өдөр бүр" }]} /> },
    { section: "Амьдралын хэв маяг", q: "Давсны хэрэглээ (1–10)?", help: "1 = бараг давс хэрэглэдэггүй, 10 = цайндаа давс хийж, давсархаг хоол их иддэг.",
      body: <Range value={a.salt_intake} onChange={(n) => set("salt_intake", n)} min={1} max={10} unit="оноо" /> },
    { section: "Амьдралын хэв маяг", q: "Бие махбодын идэвхтэй хөдөлгөөн?",
      body: <Choice value={a.activity} onChange={(v) => set("activity", v as Answers["activity"])} options={[{ v: "low", l: "Бага", d: "Долоо хоногт 150 минутаас бага" }, { v: "moderate", l: "Дунд", d: "150–300 минут" }, { v: "high", l: "Өндөр", d: "300+ минут, спорт" }]} /> },
    { section: "Амьдралын хэв маяг", q: "Жимс, ногоо хэр иддэг вэ?",
      body: <Choice value={a.fruit_veg} onChange={(v) => set("fruit_veg", v as Answers["fruit_veg"])} options={[{ v: "rare", l: "Бараг иддэггүй" }, { v: "some", l: "Долоо хоногт хэд хэд" }, { v: "daily", l: "Өдөр бүр" }]} /> },
    { section: "Орчин", q: "Агаарын бохирдолд хэр өртдөг вэ (1–10)?", help: "Гэр хороолол, түлээ нүүрсний утаа, ажлын байрны тоос зэргийг тооцно.",
      body: <Range value={a.air_pollution} onChange={(n) => set("air_pollution", n)} min={1} max={10} unit="оноо" /> },
    { section: "Эрүүл мэндийн түүх", q: "Гэр бүлд (эцэг эх, ах дүү) дараах өвчин бий юу?", help: "Олныг сонгож болно.",
      body: <Choice multi value={a.family_history.length ? a.family_history : ["none"]} onChange={(v) => toggle("family_history", v)}
        options={[{ v: "heart", l: "Зүрх судасны өвчин" }, { v: "diabetes", l: "Чихрийн шижин" }, { v: "cancer", l: "Хавдар" }, { v: "none", l: "Аль нь ч биш / мэдэхгүй" }]} /> },
    { section: "Эрүүл мэндийн түүх", q: "Сүүлийн үед дараах шинж тэмдэг илэрсэн үү?", help: "Олныг сонгож болно.",
      body: <Choice multi value={a.symptoms.length ? a.symptoms : ["none"]} onChange={(v) => toggle("symptoms", v)}
        options={[{ v: "chest_pain", l: "Хүч гаргахад цээж өвдөх" }, { v: "short_breath", l: "Амьсгаадах" }, { v: "coughing_blood", l: "Цустай ханиалгах" }, { v: "fatigue", l: "Байнгын ядаргаа" }, { v: "weight_loss", l: "Шалтгаангүй турах" }, { v: "thirst", l: "Их цангах, олон шээх" }, { v: "swallow_diff", l: "Залгихад хүндрэлтэй" }, { v: "none", l: "Аль нь ч үгүй" }]} /> },
    { section: "Нэмэлт", q: "Биеийн аль хэсэг эвгүй байна вэ?",
      body: <div className="space-y-4">
        <BodyMap value={a.body_parts} onChange={(v) => set("body_parts", v)} />
        <label className="block text-sm font-semibold">Нэмэлт тайлбар (заавал биш)
          <textarea value={a.notes} onChange={(e) => set("notes", e.target.value.slice(0, 500))} rows={3} placeholder="Жишээ нь: шөнө ханиалгадаг…"
            className="mt-1 w-full rounded-xl border p-3 font-normal outline-none focus:ring-2 focus:ring-primary/30" />
          <span className="text-xs font-normal text-muted-foreground">{a.notes.length}/500 · AI руу дамжуулахгүй</span>
        </label>
      </div> },
  ], [a, bmi]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = steps.length + 1;
  const consentStep = i === 0;
  const step = steps[i - 1];

  const submit = async () => {
    setBusy(true);
    setErr("");
    const answers = AnswersEntity.fromDTO(a);
    try {
      // validate() → POST → RiskResult + Advice; session-д ID, хэрэглэгчийн түүхэнд нэмнэ
      const assessment = await assessmentController.create(answers, user);
      nav(`/result/${assessment.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Сервер холбогдохгүй → браузер дотор ONNX-оор тооцоолно
        try {
          assessmentController.saveOffline(answers, await predictOffline(a));
          nav("/result/offline");
          return;
        } catch {
          setErr("Сервер болон оффлайн загвар хоёулаа ажилласангүй.");
        }
      } else setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      <div className="mb-6">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span className="font-semibold text-primary">{consentStep ? "Зөвшөөрөл" : step.section}</span>
          <span className="tabular-nums">{i + 1} / {total}</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-muted" role="progressbar" aria-valuenow={i + 1} aria-valuemin={1} aria-valuemax={total}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((i + 1) / total) * 100}%` }} />
        </div>
      </div>

      <div className="rounded-3xl border bg-white p-6 shadow-sm md:p-8">
        {consentStep ? (
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary"><ShieldCheck className="h-6 w-6 text-primary" /></div>
            <h1 className="mt-4 text-2xl font-extrabold">Эхлэхийн өмнө</h1>
            <ul className="mt-4 space-y-2.5 text-[15px] text-muted-foreground">
              <li>• <b className="text-foreground">Онош биш:</b> Eotoch нь эрсдэлийн урьдчилсан тооцоо гаргана, эмчийн үзлэгийг орлохгүй.</li>
              <li>• <b className="text-foreground">Цуглуулах мэдээлэл:</b> нас, хүйс, өндөр, жин, даралт, амьдралын хэв маяг, шинж тэмдэг.</li>
              <li>• <b className="text-foreground">Хамгаалалт:</b> хариултыг AES-256-GCM-ээр шифрлэж хадгална. Та хүссэн үедээ устгах боломжтой.</li>
              <li>• <b className="text-foreground">Гуравдагч тал:</b> AI зөвлөгөө үүсгэхэд зөвхөн нас, хүйс, эрсдэлийн дүнг (нэр, утас, тайлбаргүйгээр) Gemini руу илгээнэ.</li>
              <li>• {user ? <>Үнэлгээ таны <b className="text-foreground">түүхэнд</b> хадгалагдана.</> : <>Бүртгэлгүй бол түүх хадгалагдахгүй; нэвтэрвэл өсөлтөө хянах боломжтой.</>}</li>
            </ul>
            <label className="mt-6 flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--primary)]" />
              <span>Би <a href="/privacy" target="_blank" className="font-semibold text-primary underline">нууцлалын бодлого</a>-ыг уншиж, мэдээллээ боловсруулахыг зөвшөөрч байна.</span>
            </label>
          </div>
        ) : (
          <div key={i} className="animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-2xl font-extrabold">{step.q}</h1>
            {step.help && <p className="mt-1 text-muted-foreground">{step.help}</p>}
            <div className="mt-6">{step.body}</div>
          </div>
        )}

        {err && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}

        <div className="mt-8 flex gap-3">
          {i > 0 && (
            <button onClick={() => setI(i - 1)} className="flex items-center gap-1 rounded-2xl border px-5 py-3.5 font-semibold hover:bg-muted">
              <ArrowLeft className="h-4 w-4" /> Буцах
            </button>
          )}
          {i < total - 1 ? (
            <button onClick={() => setI(i + 1)} disabled={consentStep && !consent}
              className="ml-auto flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-bold text-white hover:brightness-110 disabled:opacity-40 sm:flex-none sm:px-8">
              Үргэлжлүүлэх <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={submit} disabled={busy}
              className="ml-auto flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-bold text-white hover:brightness-110 disabled:opacity-60 sm:flex-none sm:px-8">
              {busy ? <><Loader2 className="h-5 w-5 animate-spin" /> AI шинжилж байна…</> : "Үр дүн харах"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
