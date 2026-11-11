import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Clock, Loader2, MapPin, Navigation, Phone, Siren } from "lucide-react";
import { SPECIALTIES } from "../lib/format";
import { useLocation } from "../lib/useLocation";
import { Hospital } from "../domain";
import { BookingDialog } from "../components/BookingDialog";

export function Hospitals() {
  const [params, setParams] = useSearchParams();
  const specialty = params.get("specialty") ?? "";
  const emergency = params.get("emergency") === "1";
  const prioritize = params.getAll("prioritize");
  const geo = useLocation();
  const [list, setList] = useState<Hospital[] | null>(null);
  const [err, setErr] = useState("");
  const [booking, setBooking] = useState<Hospital | null>(null);

  useEffect(() => {
    if (!geo.ready) return;
    setList(null);
    Hospital.searchNearby(geo.lat, geo.lng, { specialty: specialty || undefined, emergency, prioritize })
      .then(setList)
      .catch((e) => setErr(e.message));
  }, [geo.ready, geo.lat, geo.lng, specialty, emergency, prioritize.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <h1 className="text-3xl font-extrabold">Ойрын эмнэлэг</h1>
      <p className="mt-1 text-muted-foreground flex items-center gap-1.5">
        <Navigation className="h-4 w-4" />
        {!geo.ready ? "Байршил тодорхойлж байна…" : geo.fallback ? "Байршил зөвшөөрөөгүй тул Улаанбаатарын төвөөс тооцов" : "Таны байршлаас зайгаар эрэмбэлэв"}
      </p>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Мэргэжлээр шүүх">
        <button onClick={() => setFilter("specialty", null)} aria-pressed={!specialty}
          className={`rounded-full border px-4 py-2 text-sm font-medium ${!specialty ? "border-primary bg-primary text-white" : "bg-white hover:bg-muted"}`}>Бүгд</button>
        {SPECIALTIES.map((s) => (
          <button key={s} onClick={() => setFilter("specialty", s)} aria-pressed={specialty === s}
            className={`rounded-full border px-4 py-2 text-sm font-medium ${specialty === s ? "border-primary bg-primary text-white" : "bg-white hover:bg-muted"}`}>{s}</button>
        ))}
        <button onClick={() => setFilter("emergency", emergency ? null : "1")} aria-pressed={emergency}
          className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium ${emergency ? "border-red-600 bg-red-600 text-white" : "bg-white hover:bg-muted"}`}>
          <Siren className="h-4 w-4" /> 24/7 яаралтай
        </button>
      </div>

      {err && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{err}</p>}
      {!list && !err && <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>}
      {list && list.length === 0 && <p className="mt-10 text-center text-muted-foreground">Шүүлтүүрт тохирох эмнэлэг олдсонгүй.</p>}

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {list?.map((h) => (
          <li key={h.id} className={`rounded-3xl border bg-white p-5 ${h.match ? "ring-2 ring-primary/40" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold leading-snug">{h.name}</h2>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {h.address}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-2xl font-extrabold text-primary tabular-nums">{geo.controller.calcDistance(h).toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">км</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${h.open_now ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                {h.open_now ? "Одоо нээлттэй" : "Хаалттай"}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{h.type === "Public" ? "Улсын" : "Хувийн"}</span>
              {h.isEmergency && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">Яаралтай тусламж</span>}
              {!!h.match && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">Танд тохирох</span>}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{h.specialties.join(" · ")}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="h-4 w-4" /> {h.hours}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setBooking(h)} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:brightness-110">Цаг авах</button>
              {h.phone && <a href={`tel:${h.phone}`} className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-muted"><Phone className="h-4 w-4" /> {h.phone}</a>}
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-muted"><Navigation className="h-4 w-4" /> Зам</a>
            </div>
            {h.needs_verification && <p className="mt-2 text-xs text-muted-foreground">Байршил ойролцоо; утасны дугаар баталгаажаагүй.</p>}
          </li>
        ))}
      </ul>
      {booking && <BookingDialog hospital={booking} specialty={specialty || prioritize[0]} onClose={() => setBooking(null)} />}
    </div>
  );
}
