import { useEffect, useState } from "react";
import { LocationController, type GeoCoords } from "../domain";

/** Програм даяар нэг LocationController — GPS-ийг нэг л удаа асууна. */
export const locationController = new LocationController();
let pending: Promise<GeoCoords> | null = null;
let resolved = false;

/** React hook: LocationController.getCurrentPos()-ийн үр дүнг дэлгэцэд хүргэнэ. */
export function useLocation(enabled = true) {
  const [ready, setReady] = useState(resolved);
  const [coords, setCoords] = useState<GeoCoords>(locationController.getCoords());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    pending ??= locationController.getCurrentPos().then((c) => { resolved = true; return c; });
    pending.then((c) => {
      if (!alive) return;
      setCoords(c);
      setReady(true);
    });
    return () => { alive = false; };
  }, [enabled]);

  return { ...coords, ready, fallback: locationController.isFallback(), controller: locationController };
}
