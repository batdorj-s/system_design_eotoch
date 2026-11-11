import { useEffect, useState } from "react";
import { PhoneCall, MapPin, X } from "lucide-react";
import { useLocation } from "../lib/useLocation";
import { Hospital } from "../domain";

export function SOSDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const geo = useLocation(open);
  const [list, setList] = useState<Hospital[]>([]);

  useEffect(() => {
    if (!open || !geo.ready) return;
    // showNearbyHospitals: 24/7 яаралтай тусламжтай эмнэлгүүдийг зайгаар
    Hospital.searchNearby(geo.lat, geo.lng, { emergency: true })
      .then((hs) => setList(geo.controller.sortByDistance(hs).slice(0, 3)))
      .catch(() => setList([]));
  }, [open, geo.ready, geo.lat, geo.lng]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-red-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sos-title">
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted" aria-label="Хаах">
          <X className="h-5 w-5" />
        </button>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <PhoneCall className="h-8 w-8 text-red-600" />
        </div>
        <h2 id="sos-title" className="text-center text-2xl font-extrabold">Яаралтай тусламж</h2>
        <p className="mt-1 text-center text-muted-foreground">Амь насанд аюултай нөхцөлд шууд залгана уу.</p>
        <a href="tel:103" className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-red-600 py-4 text-xl font-extrabold text-white hover:bg-red-700">
          <PhoneCall className="h-6 w-6" /> 103 залгах
        </a>
        {list.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold text-muted-foreground">Ойрын яаралтай тусламжийн эмнэлэг</p>
            <ul className="space-y-2">
              {list.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{h.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {geo.controller.calcDistance(h).toFixed(1)} км · {h.hours}
                    </p>
                  </div>
                  {h.phone && (
                    <a href={`tel:${h.phone}`} className="shrink-0 rounded-lg bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground">
                      {h.phone}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
