import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Brain, ClipboardList, HeartPulse, Hospital, Lock, Mic, Scale, ShieldCheck } from "lucide-react";

const STEPS_STATS = [
  { v: "27.5%", l: "даралт ихсэлттэй" },
  { v: "54.4%", l: "илүүдэл жинтэй" },
  { v: "6.9%", l: "чихрийн шижинтэй" },
  { v: "49.1%", l: "эрэгтэйчүүд тамхи татдаг" },
];

const FEATURES = [
  { icon: ClipboardList, t: "3 минутын асуулга", d: "Биеийн үзүүлэлт, амьдралын хэв маяг, шинж тэмдгийн 15 асуулт." },
  { icon: Brain, t: "3 ML загвар + SHAP", d: "Зүрх судас, чихрийн шижин, хавдрын эрсдэл ба түүний шалтгааныг тайлбарлана." },
  { icon: Mic, t: "Дуут AI туслах", d: "Монгол хэлээр асуулт тавьж, зөвлөгөөгөө дуугаар сонсоно." },
  { icon: Hospital, t: "Эмнэлэг ба цаг захиалга", d: "Ойрын эмнэлгийг мэргэжлээр нь шүүж, цаг захиална." },
];

function BMICalc() {
  const [h, setH] = useState(170);
  const [w, setW] = useState(70);
  const bmi = w / (h / 100) ** 2;
  const cat = bmi < 18.5 ? ["Жингийн дутагдалтай", "text-amber-600"] : bmi < 25 ? ["Хэвийн", "text-green-600"] : bmi < 30 ? ["Илүүдэл жинтэй", "text-amber-600"] : ["Таргалалттай", "text-red-600"];
  const pos = Math.min(100, Math.max(0, ((bmi - 15) / 25) * 100));
  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Scale className="h-5 w-5 text-primary" /> BMI тооцоолуур</h3>
      <div className="mt-5 space-y-5">
        {[["Өндөр", h, setH, 120, 210, "см"], ["Жин", w, setW, 35, 180, "кг"]].map(([label, val, set, min, max, unit]) => (
          <label key={label as string} className="block">
            <div className="flex justify-between text-sm"><span className="font-medium">{label as string}</span><span className="tabular-nums font-semibold">{val as number} {unit as string}</span></div>
            <input type="range" min={min as number} max={max as number} value={val as number}
              onChange={(e) => (set as (n: number) => void)(+e.target.value)} className="mt-2 w-full accent-[var(--primary)]" />
          </label>
        ))}
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Таны BMI</p>
          <p className="font-display text-4xl font-extrabold">{bmi.toFixed(1)}</p>
        </div>
        <p className={`text-lg font-bold ${cat[1]}`}>{cat[0]}</p>
      </div>
      <div className="relative mt-3 h-2.5 rounded-full bg-gradient-to-r from-amber-300 via-green-400 via-40% to-red-500">
        <div className="absolute -top-1 h-4.5 w-1.5 rounded-full bg-foreground" style={{ left: `calc(${pos}% - 3px)` }} aria-hidden />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>15</span><span>18.5</span><span>25</span><span>30</span><span>40</span></div>
    </div>
  );
}

export function Home() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-b from-secondary to-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.2fr_1fr] md:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20">
              <HeartPulse className="h-3.5 w-3.5" /> ДЭМБ STEPS судалгаанд суурилсан
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] md:text-5xl">
              Халдварт бус өвчний эрсдэлээ <span className="text-primary">3 минутад</span> мэдээрэй
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Машин сургалтын 3 загвар таны зүрх судас, чихрийн шижин, хавдрын эрсдэлийг тооцож,
              <b className="text-foreground"> яг юу нөлөөлж байгааг</b> тайлбарлаад, хувь хүнд тохирсон зөвлөгөө өгнө.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/assessment" className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-4 text-lg font-bold text-white shadow-lg shadow-primary/25 hover:brightness-110">
                Үнэлгээ эхлэх <ArrowRight className="h-5 w-5" />
              </Link>
              <Link to="/hospitals" className="inline-flex items-center gap-2 rounded-2xl border bg-white px-6 py-4 text-lg font-semibold hover:bg-muted">
                Эмнэлэг хайх
              </Link>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="h-4 w-4" /> Бүртгэлгүй ашиглах боломжтой · Өгөгдөл AES-256 шифрлэлттэй
            </p>
          </div>
          <BMICalc />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-extrabold">Монголын хүн амын эрүүл мэнд</h2>
        <p className="mt-1 text-muted-foreground">ДЭМБ-ын STEPS 2013 судалгаа, 15–64 нас</p>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {STEPS_STATS.map((s) => (
            <div key={s.l} className="rounded-2xl border bg-white p-5">
              <p className="font-display text-3xl font-extrabold text-primary">{s.v}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.t} className="rounded-2xl border bg-white p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary"><f.icon className="h-5 w-5 text-primary" /></div>
              <h3 className="mt-4 font-bold">{f.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-start gap-4 rounded-3xl bg-foreground p-8 text-white md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5" /> Ил тод хиймэл оюун</h3>
            <p className="mt-1 max-w-2xl text-white/75">Загварыг ямар өгөгдлөөр сургасан, хэр нарийвчлалтай, ямар хязгаарлалттай болохыг бүрэн нээлттэй харуулна.</p>
          </div>
          <Link to="/insights" className="shrink-0 rounded-xl bg-white px-5 py-3 font-semibold text-foreground hover:bg-white/90">Өгөгдөл ба ML →</Link>
        </div>
      </section>
    </>
  );
}
