import { useEffect, useState } from "react";
import { LocationController, type GeoCoords } from "../domain";

/** Програм даяар нэг LocationController — GPS-ийг нэг л удаа асууна. */
export const locationController = new LocationController();

/**
 * React hook. Эхнээсээ Сүхбаатарын талбайгаар `ready = true` буцаана (хүлээлгүй).
 * Хэрэглэгч байршлаа зөвшөөрвөл GPS-ийн байршил ирж автоматаар шинэчлэгдэнэ.
 */
export function useLocation(enabled = true) {
  const [coords, setCoords] = useState<GeoCoords>(locationController.getCoords());
  const [fallback, setFallback] = useState(locationController.isFallback());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const update = (c: GeoCoords) => {
      if (!alive) return;
      setCoords(c);
      setFallback(locationController.isFallback());
    };
    const off = locationController.subscribe(update);
    locationController.getCurrentPos().then(update);
    return () => { alive = false; off(); };
  }, [enabled]);

  return { ...coords, ready: true, fallback, controller: locationController };
}
