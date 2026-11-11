/**
 * «control» ApiController — серверийн REST API-тай харилцах цорын ганц цэг.
 * Бусад бүх Control болон Entity класс HTTP хүсэлтээ энэ классаар дамжуулна.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const TOKEN_KEY = "eotoch_token";

export class ApiController {
  /** localStorage хаалттай (хувийн горим) үед санах ойд хадгална. */
  private memoryToken: string | null = null;

  constructor(private readonly baseUrl: string = (import.meta.env?.VITE_API_URL as string | undefined) ?? "") {}

  /** Токеныг хүсэлт бүрт хадгалалтаас уншина — бусад таб нэвтэрч/гарахад ч зөрөхгүй. */
  private get token(): string | null {
    try { return localStorage.getItem(TOKEN_KEY) ?? this.memoryToken; } catch { return this.memoryToken; }
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  async post<T>(path: string, json?: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", json });
  }

  async patch<T>(path: string, json?: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", json });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  setToken(t: string): void {
    this.memoryToken = t;
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* хувийн горим */ }
  }

  clearToken(): void {
    this.memoryToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* хувийн горим */ }
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  /** Ерөнхий хүсэлт (staff/admin хуудсууд lib/api.ts-ээр дамжуулан ашиглана). */
  async send<T>(method: string, path: string, json?: unknown): Promise<T> {
    return this.request<T>(path, { method, json });
  }

  private async request<T>(path: string, init: { method: string; json?: unknown }): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: init.method,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      });
    } catch {
      throw new ApiError(0, "Сервертэй холбогдож чадсангүй.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && this.token) this.clearToken();
      throw new ApiError(res.status, ApiController.message(data, res.status));
    }
    return data as T;
  }
}

export namespace ApiController {
  /** FastAPI-ийн алдааны хариуг хэрэглэгчид ойлгомжтой монгол текст болгоно. */
  export function message(body: unknown, status: number): string {
    const d = (body as { detail?: unknown } | null)?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length) {
      const first = d[0] as { loc?: string[]; msg?: string };
      return `Оруулсан утга буруу байна (${first.loc?.slice(-1)[0] ?? ""}): ${first.msg ?? ""}`;
    }
    if (status === 429) return "Хэт олон хүсэлт илгээлээ. Түр хүлээнэ үү.";
    return "Серверт алдаа гарлаа. Дахин оролдоно уу.";
  }
}

/** Програм даяар ашиглах нэг instance (Singleton). */
export const api = new ApiController();
