import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AlertTriangle, BookmarkPlus, ChevronDown, FileDown, Hospital, Info, Loader2, RefreshCw, Sparkles, Volume2, WifiOff } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ALGO_LABEL, fmtDateTime, pct } from "../lib/format";
import { assessmentController, type Assessment, type DiseaseRisk } from "../domain";
import { FactorBars, LevelBadge, RiskRadar, RiskRing } from "../components/RiskVisuals";
import { speak } from "../components/ChatAssistant";

const PROVIDER: Record<string, string> = { gemini: "Gemini AI", ollama: "Llama 3 (локал)", template: "Мэдлэгийн сан", rule: "Дүрэм" };

function DiseaseCard({ risk }: { risk: DiseaseRisk }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-3xl border bg-white p-5">
      <div className="flex items-center gap-4">
        <RiskRing value={risk.value} level={risk.level} size={96} />
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{risk.label}</h3>
          <div className="mt-1 flex items-center gap-2"><LevelBadge level={risk.level} /></div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {risk.kind === "relative_index" ? "Харьцангуй эрсдэлийн индекс" : "Тооцоолсон магадлал"} · {ALGO_LABEL[risk.algorithm] ?? risk.algorithm}
          </p>
        </div>
      </div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="mt-4 flex w-full items-center justify-between rounded-xl bg-muted/60 px-3 py-2 text-sm font-semibold hover:bg-muted">
        Яагаад ийм дүн гарсан бэ? <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-4">
          <FactorBars risk={risk} />
          <p className="mt-3 text-xs text-muted-foreground">
            Хувь нэмэр (SHAP, хувийн пункт): дундаж хүнээс ({pct(risk.baseline)}) таны эрсдэлийг хэрхэн өөрчилсөн. “OR” — хэвлэгдсэн судалгааны odds ratio.
          </p>
        </div>
      )}
    </div>
  );
}

export function Result() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<Assessment | null>(null);
  const [err, setErr] = useState("");
  const [regen, setRegen] = useState(false);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    assessmentController.load(id, user).then(setData).catch((e: Error) => setErr(e.message));
  }, [id, user]);

  if (err) return <div className="mx-auto max-w-xl px-4 py-16 text-center"><p className="text-red-700">{err}</p><Link to="/assessment" className="mt-4 inline-block text-primary underline">Шинэ үнэлгээ</Link></div>;
  if (!data) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const r = data.getResult();
  const advice = data.getAdvice();
  const specialties = r.getSpecialties().map((s) => s.name);
  const urgent = r.isUrgent();
  const [heart, diabetes, cancer] = (["heart", "diabetes", "cancer"] as const).map((k) => r.getRisk(k));

  const regenerate = async () => {
    setRegen(true);
    try {
      setData(await assessmentController.regenerateAdvice(data));
    } finally {
      setRegen(false);
    }
  };

  const claim = async () => {
    if (!user) return;
    const owned = await assessmentController.claim(data, user);
    if (owned) setData(owned);
    setClaimed(owned !== null);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      {r.offline && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <WifiOff className="h-4 w-4 shrink-0" /> Сервертэй холбогдоогүй тул браузер дотор ONNX загвараар тооцоолов. Хадгалагдаагүй, AI зөвлөгөөгүй.
        </div>
      )}
      {urgent && (
        <div className="mb-6 rounded-3xl bg-red-600 p-5 text-white shadow-lg" role="alert">
          <p className="flex items-center gap-2 text-lg font-extrabold"><AlertTriangle className="h-6 w-6" /> Яаралтай анхаарна уу</p>
          <ul className="mt-2 space-y-1">
            {r.red_flags.map((f) => <li key={f}>• {f}</li>)}
            {r.red_flags.length === 0 && <li>• Эрсдэл маш өндөр (85%+) — эмнэлэгт аль болох хурдан хандана уу.</li>}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="tel:103" className="rounded-xl bg-white px-4 py-2.5 font-bold text-red-700">103 залгах</a>
            <Link to={`/hospitals?emergency=1${specialties.map((s) => `&prioritize=${encodeURIComponent(s)}`).join("")}`} className="rounded-xl bg-red-800 px-4 py-2.5 font-semibold">Ойрын эмнэлэг</Link>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-3xl border bg-white p-6">
          <div className="flex flex-col items-center gap-6 sm:flex-row">
            {r.overall ? <RiskRing value={r.overall.value} level={r.overall.level} size={160} label="нийт эрсдэл" /> : null}
            <div className="text-center sm:text-left">
              <p className="text-sm text-muted-foreground">{fmtDateTime(data.created_at.toISOString())}</p>
              <h1 className="mt-1 text-3xl font-extrabold">{r.overall ? <>Нийт эрсдэл: <span>{r.overall.level_label}</span></> : "Эрсдэлийн оноо тооцоогүй"}</h1>
              <p className="mt-2 text-muted-foreground">BMI <b className="text-foreground">{r.bmi}</b> · {r.bmi_category}</p>
              <p className="mt-1 text-xs text-muted-foreground">Загварын хувилбар: {r.model_version}</p>
            </div>
          </div>
          {r.scope_message && <p className="mt-5 rounded-2xl bg-amber-50 p-4 text-amber-900">{r.scope_message}</p>}
          <div className="no-print mt-6 flex flex-wrap gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-muted"><FileDown className="h-4 w-4" /> PDF тайлан</button>
            <Link to={`/hospitals?${specialties.map((s) => `prioritize=${encodeURIComponent(s)}`).join("&")}`} className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-muted"><Hospital className="h-4 w-4" /> Эмнэлэг хайх</Link>
            <Link to="/assessment" className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-muted"><RefreshCw className="h-4 w-4" /> Дахин үнэлэх</Link>
            {!r.offline && (user ? (
              <button onClick={claim} disabled={claimed} className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-60">
                <BookmarkPlus className="h-4 w-4" /> {claimed ? "Түүхэнд нэмэгдлээ" : "Түүхэнд хадгалах"}
              </button>
            ) : (
              <Link to={`/login?claim=${id}`} className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground"><BookmarkPlus className="h-4 w-4" /> Нэвтэрч хадгалах</Link>
            ))}
          </div>
        </section>
        {r.radar.length > 0 && (
          <section className="rounded-3xl border bg-white p-6">
            <h2 className="text-lg font-bold">Эрсдэлийн 5 тэнхлэг</h2>
            <RiskRadar data={r.radar} />
          </section>
        )}
      </div>

      {heart && diabetes && cancer && (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <DiseaseCard risk={heart} />
          <DiseaseCard risk={diabetes} />
          <DiseaseCard risk={cancer} />
        </div>
      )}

      {advice && (
        <section className="mt-6 rounded-3xl border bg-white p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-bold"><Sparkles className="h-5 w-5 text-primary" /> Танд зориулсан зөвлөгөө</h2>
            <div className="no-print flex items-center gap-2">
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{PROVIDER[advice.provider]}</span>
              <button onClick={() => speak(advice.getText())} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted"><Volume2 className="h-4 w-4" /> Сонсох</button>
              {advice.provider === "template" && !r.offline && (
                <button onClick={regenerate} disabled={regen} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60">
                  <RefreshCw className={`h-4 w-4 ${regen ? "animate-spin" : ""}`} /> AI-аар дахин
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 whitespace-pre-line text-[16px] leading-relaxed">{advice.text}</div>
          {advice.getSources().length > 0 && (
            <details className="mt-5 rounded-2xl bg-muted/50 p-4 text-sm">
              <summary className="cursor-pointer font-semibold">Ашигласан эх сурвалж ({advice.getSources().length})</summary>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                {advice.getSources().map((s, i) => <li key={i}>• {s.content} <i>({s.source})</i></li>)}
              </ul>
            </details>
          )}
        </section>
      )}

      {specialties.length > 0 && (
        <section className="no-print mt-6 rounded-3xl bg-secondary p-6">
          <h2 className="font-bold text-secondary-foreground">Хандахыг зөвлөж буй мэргэжил</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {specialties.map((s) => (
              <Link key={s} to={`/hospitals?specialty=${encodeURIComponent(s)}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-secondary-foreground hover:shadow">{s} →</Link>
            ))}
          </div>
        </section>
      )}

      <p className="mt-6 flex items-start gap-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Энэ нь эмнэлгийн онош биш, машин сургалтын загварын урьдчилсан тооцоо юм. Эмчтэй зөвлөлдөнө үү. Загварын нарийвчлал, хязгаарлалтыг <Link to="/insights" className="underline">энд</Link> харна уу.
      </p>
    </div>
  );
}
