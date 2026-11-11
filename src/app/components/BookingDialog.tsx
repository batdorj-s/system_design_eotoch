/**
 * «boundary» BookingUI — зөвхөн BookingController-оор дамжуулж ажиллана:
 *   showRecommended → selectDoctor → showFreeSlots → selectSlot → confirmBooking
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Loader2, Stethoscope, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { locationController } from "../lib/useLocation";
import { BookingController, Specialty, assessmentController, session, type Booking, type Hospital, type TimeSlot } from "../domain";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WD = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];

export function BookingDialog({ hospital, specialty, onClose }: { hospital: Hospital; specialty?: string; onClose: () => void }) {
  const { user } = useAuth();
  const controller = useMemo(() => new BookingController(locationController), []);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  // showRecommended: эрсдэлээс санал болгосон мэргэжил энэ эмнэлэгт байвал түүнийг сонгоно
  const [spec, setSpec] = useState(specialty && hospital.specialties.includes(specialty) ? specialty : hospital.specialties[0]);
  const doctor = useMemo(() => hospital.getDoctors(Specialty.byName(spec))[0], [hospital, spec]);
  const [day, setDay] = useState(iso(days[1]));
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [share, setShare] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Booking | null>(null);
  const aid = session.getLastId();

  // selectDoctor + showFreeSlots: эмчийн тухайн өдрийн хуваарийг (сул/захиалагдсан) харуулна
  useEffect(() => {
    if (!doctor) return;
    let alive = true;
    setSlot(null);
    controller.selectDoctor(doctor);
    controller.getFreeSlots(doctor, day)
      .then(() => alive && setSlots([...doctor.getSchedule(day)]))
      .catch(() => alive && setSlots([]));
    return () => { alive = false; };
  }, [controller, doctor, day]);

  const pick = (s: TimeSlot) => {
    controller.selectSlot(s); // сул биш бол алдаа шиднэ
    setSlot(s);
  };

  const submit = async () => {
    setErr("");
    if (!slot) return setErr("Цагаа сонгоно уу.");
    if (name.trim().length < 2) return setErr("Нэрээ оруулна уу.");
    if (!/^\+?\d{8,12}$/.test(phone)) return setErr("Утасны дугаар 8 оронтой байх ёстой.");
    setBusy(true);
    try {
      // Хуваалцахыг зөвшөөрсөн үед л үнэлгээг ачаалж холбоно (Assessment 0..1 ── 0..* Booking)
      const assessment = share && aid && aid !== "offline" ? await assessmentController.load(aid, user) : null;
      // book(u, slot, a) — диаграмын сигнатур; нэвтрээгүй бол u = null
      setDone(await controller.book(user, slot, assessment, { name: name.trim(), phone }, share));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="bk-title">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="bk-title" className="text-xl font-extrabold">Цаг захиалах</h2>
            <p className="text-sm text-muted-foreground">{hospital.name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-muted" aria-label="Хаах"><X className="h-5 w-5" /></button>
        </div>

        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-primary" />
            <p className="mt-3 text-lg font-bold">Захиалга илгээгдлээ</p>
            <p className="mt-1 font-display text-3xl font-extrabold text-primary">{done.code}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {done.slot.date} · {done.slot.startTime}–{done.slot.endTime} · {done.specialty}<br />
              Эмнэлгийн ажилтан баталгаажуулсны дараа төлөв нь “Баталгаажсан” болно. Кодоо хадгална уу.
            </p>
            <button onClick={onClose} className="mt-6 w-full rounded-xl bg-primary py-3 font-semibold text-white">Болсон</button>
          </div>
        ) : (
          <div className="space-y-5">
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-semibold">Мэргэжил</legend>
              <div className="flex flex-wrap gap-2">
                {hospital.specialties.map((s) => (
                  <button key={s} type="button" onClick={() => setSpec(s)} aria-pressed={spec === s}
                    className={`rounded-full border px-3 py-1.5 text-sm ${spec === s ? "border-primary bg-secondary text-secondary-foreground font-semibold" : "hover:bg-muted"}`}>{s}</button>
                ))}
              </div>
              {doctor && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Stethoscope className="h-4 w-4" /> {doctor.title} · {doctor.name} · {doctor.roomNo} тоот
                </p>
              )}
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><CalendarDays className="h-4 w-4" /> Өдөр</legend>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => {
                  const v = iso(d);
                  return (
                    <button key={v} type="button" onClick={() => setDay(v)} aria-pressed={day === v}
                      className={`flex w-14 shrink-0 flex-col items-center rounded-xl border py-2 ${day === v ? "border-primary bg-primary text-white" : "hover:bg-muted"}`}>
                      <span className="text-xs opacity-80">{WD[d.getDay()]}</span>
                      <span className="text-lg font-bold">{d.getDate()}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-semibold">Цаг</legend>
              <div className="grid grid-cols-4 gap-2">
                {slots.map((s) => (
                  <button key={s.id} type="button" disabled={!s.isFree()} onClick={() => pick(s)} aria-pressed={slot === s}
                    className={`rounded-lg border py-2 text-sm tabular-nums ${slot === s ? "border-primary bg-primary text-white" : s.isFree() ? "hover:bg-muted" : "cursor-not-allowed bg-muted text-muted-foreground line-through"}`}>
                    {s.startTime}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">Нэр
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:ring-2 focus:ring-primary/30" />
              </label>
              <label className="text-sm font-semibold">Утас
                <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))} inputMode="tel" placeholder="99112233" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:ring-2 focus:ring-primary/30" />
              </label>
            </div>
            {aid && aid !== "offline" && (
              <label className="flex items-start gap-3 rounded-xl bg-muted/60 p-3 text-sm">
                <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
                <span>Сүүлийн үнэлгээний <b>хураангуйг</b> (эрсдэлийн хувь, BMI) эмнэлэгт дамжуулахыг зөвшөөрч байна. Хариултууд тань дамжихгүй.</span>
              </label>
            )}
            {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}
            <button onClick={submit} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-semibold text-white hover:brightness-110 disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Захиалах
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
