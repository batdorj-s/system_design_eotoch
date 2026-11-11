/**
 * Хуучин функц хэлбэрийн API клиент — одоо domain/ApiController руу дамжуулдаг нимгэн давхарга.
 * Диаграмд ороогүй хуудсууд (staff, admin, insights) үүнийг ашиглана; токен, алдаа нэг газраас.
 */
import { api as apiController } from "../domain/ApiController";

export { ApiError } from "../domain/ApiController";

export function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  return apiController.send<T>(init.method ?? "GET", path, init.json);
}

export const qs = (params: Record<string, string | number | boolean | undefined | null | string[]>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => u.append(k, x));
    else u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
};
