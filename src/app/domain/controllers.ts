/**
 * «control» классууд — "Өргөтгөсөн класс диаграм (Boundary + Control + Entity)"-ын дагуу.
 * Boundary (UI) нь Entity-д шууд хандахгүй; зөвхөн эдгээр Control-оор дамжина.
 * Сервер, sessionStorage, GPS руу хандах БҮХ ажил энд — Entity-үүд цэвэр хэвээр.
 *
 *   AuthController       ──▶ ApiController, User
 *   SessionController    ──▶ Assessment
 *   AssessmentController ──▶ ApiController, Assessment, Advice, User   (диаграмын өргөтгөл)
 *   LocationController   ──▶ ApiController, Hospital
 *   BookingController    ──▶ ApiController, LocationController, Specialty, Doctor, TimeSlot, Booking
 */
import { api, ApiController } from "./ApiController";
import {
  Advice, Assessment, Booking, Doctor, Hospital, RiskResult, Specialty, TimeSlot, User,
  type Answers, type HospitalDTO, type HospitalFilter, type UserDTO,
} from "./entities";
import type * as DTO from "../lib/types";

export interface GeoCoords { lat: number; lng: number }

// ─────────────────────────────────────────────────────────────── AuthController
export class AuthController {
  private currentUser: User | null = null;
  private loading: Promise<User | null> | null = null;

  constructor(private readonly apiCtl: ApiController = api) {}

  async login(email: string, pw: string): Promise<User> {
    const r = await this.apiCtl.post<{ token: string; user: UserDTO }>("/api/auth/login", { email, password: pw });
    return this.start(r);
  }

  async register(data: { email: string; password: string; name: string; phone?: string; consent: boolean }): Promise<User> {
    if (!data.consent) throw new Error("Нууцлалын бодлогыг зөвшөөрөх шаардлагатай.");
    return this.start(await this.apiCtl.post<{ token: string; user: UserDTO }>("/api/auth/register", data));
  }

  logout(): void {
    this.apiCtl.clearToken();
    this.currentUser = null;
    this.loading = null;
  }

  /** Хадгалсан токеноор хэрэглэгчийг сэргээнэ. Зэрэг дуудагдсан ч сервер рүү нэг л удаа хандана. */
  getUser(): Promise<User | null> {
    this.loading ??= (async () => {
      if (!this.currentUser && this.apiCtl.hasToken()) {
        try {
          this.currentUser = User.fromDTO(await this.apiCtl.get<UserDTO>("/api/auth/me"));
        } catch {
          this.apiCtl.clearToken();
        }
      }
      return this.currentUser;
    })();
    return this.loading;
  }

  private start(r: { token: string; user: UserDTO }): User {
    this.apiCtl.setToken(r.token);
    this.currentUser = User.fromDTO(r.user);
    this.loading = Promise.resolve(this.currentUser);
    return this.currentUser;
  }
}

// ─────────────────────────────────────────────────────────────── SessionController
const LAST = "eotoch_last_id";
const OFFLINE = "eotoch_offline";

/** Зөвхөн sessionStorage (таб хаагдахад устна) — эрүүл мэндийн өгөгдөл төхөөрөмж дээр үлдэхгүй. */
export class SessionController {
  private lastAssessmentId: string | null = null;
  private offline: Assessment | null = null;

  saveLastId(id: string): void {
    this.lastAssessmentId = id;
    try { sessionStorage.setItem(LAST, id); } catch { /* хувийн горим */ }
  }

  getLastId(): string | null {
    if (this.lastAssessmentId) return this.lastAssessmentId;
    try { return sessionStorage.getItem(LAST); } catch { return null; }
  }

  saveOffline(a: Assessment): void {
    this.offline = a;
    try { sessionStorage.setItem(OFFLINE, JSON.stringify(a)); } catch { /* хувийн горим */ }
  }

  getOffline(): Assessment | null {
    if (this.offline) return this.offline;
    try {
      const raw = sessionStorage.getItem(OFFLINE);
      return raw ? (this.offline = Assessment.fromDTO(JSON.parse(raw))) : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.lastAssessmentId = null;
    this.offline = null;
    try { sessionStorage.removeItem(LAST); sessionStorage.removeItem(OFFLINE); } catch { /* хувийн горим */ }
  }
}

/** Програм даяар нэг session. */
export const session = new SessionController();

// ─────────────────────────────────────────────────────────────── AssessmentController
/** Үнэлгээг үүсгэх, ачаалах, зөвлөгөө, түүх — серверийн хэсэг (Entity-ээс салгасан). */
export class AssessmentController {
  constructor(private readonly apiCtl: ApiController = api, private readonly sess: SessionController = session) {}

  /** validate() → POST → RiskResult + SHAP + Advice; хэрэглэгчийн composition-д нэмнэ. */
  async create(answers: Answers, user: User | null): Promise<Assessment> {
    if (!answers.validate()) throw new Error("Асуулгын утга хүрээнээс гадуур байна.");
    const a = Assessment.fromDTO(await this.apiCtl.post<DTO.Assessment>("/api/assessments", { answers: answers.toJSON(), consent: true }));
    this.sess.saveLastId(a.id);
    if (user && a.userId === user.id) user.addAssessment(a);
    return a;
  }

  /** Сервер холбогдохгүй үед браузерт (ONNX) тооцоолсон дүнг session-д хадгална. */
  saveOffline(answers: Answers, result: DTO.RiskResult): Assessment {
    const a = Assessment.offline(answers, result);
    this.sess.saveOffline(a);
    return a;
  }

  async load(id: string, user: User | null): Promise<Assessment> {
    if (id === "offline") {
      const o = this.sess.getOffline();
      if (!o) throw new Error("Оффлайн үр дүн олдсонгүй.");
      return o;
    }
    const a = Assessment.fromDTO(await this.apiCtl.get<DTO.Assessment>(`/api/assessments/${encodeURIComponent(id)}`));
    if (user && a.userId === user.id) user.addAssessment(a);
    return a;
  }

  async regenerateAdvice(a: Assessment): Promise<Assessment> {
    const adv = Advice.fromDTO(await this.apiCtl.post<DTO.Advice>(`/api/assessments/${a.id}/advice`));
    return a.withAdvice(adv);
  }

  /** Нэргүй хийсэн үнэлгээг хэрэглэгчийн түүхэнд нэмнэ (composition-ийг бөглөнө). */
  async claim(a: Assessment, user: User): Promise<Assessment | null> {
    const r = await this.apiCtl.post<{ claimed: boolean }>(`/api/me/assessments/${a.id}/claim`);
    if (!r.claimed) return null;
    const owned = a.withOwner(user.id);
    user.addAssessment(owned);
    return owned;
  }

  /** Түүхийн жагсаалт (хураангуй). Бүрэн Assessment-ийг load()-оор ачаална. */
  listByUser(_user: User): Promise<DTO.AssessmentSummary[]> {
    return this.apiCtl.get<DTO.AssessmentSummary[]>("/api/me/assessments");
  }
}

/** Програм даяар нэг AssessmentController. */
export const assessmentController = new AssessmentController();

// ─────────────────────────────────────────────────────────────── LocationController
/** Сүхбаатарын талбай — байршил зөвшөөрөгдөөгүй үеийн анхдагч цэг (хотын төв). */
export const SUKHBAATAR_SQUARE: GeoCoords = { lat: 47.9189, lng: 106.9176 };

export class LocationController {
  private lat = SUKHBAATAR_SQUARE.lat;
  private lng = SUKHBAATAR_SQUARE.lng;
  private fallback = true;
  private readonly listeners = new Set<(c: GeoCoords) => void>();
  private gpsRequested = false;

  constructor(private readonly apiCtl: ApiController = api) {}

  /**
   * Байршлыг ХҮЛЭЭЛГҮЙ буцаана:
   *  • зөвшөөрөл өгсөн бол GPS (8 сек дотор ирэхгүй бол Сүхбаатарын талбай)
   *  • татгалзсан / хараахан асуугаагүй / дэмжихгүй бол ШУУД Сүхбаатарын талбай,
   *    дараа нь хэрэглэгч зөвшөөрвөл subscribe()-ээр шинэ байршил ирнэ.
   */
  async getCurrentPos(): Promise<GeoCoords> {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return this.getCoords();
    let state: PermissionState | "unknown" = "unknown";
    try {
      state = (await navigator.permissions.query({ name: "geolocation" })).state;
    } catch { /* Safari-ийн хуучин хувилбар permissions API-гүй */ }

    if (state === "denied") return this.getCoords();
    if (state === "granted") {
      return Promise.race([
        this.requestGps(),
        new Promise<GeoCoords>((r) => setTimeout(() => r(this.getCoords()), 8000)),
      ]);
    }
    void this.requestGps(); // "prompt": асуулт харагдана, хариулахыг хүлээхгүй
    return this.getCoords();
  }

  /** GPS шинэчлэлтийг сонсох; буцаах функц нь бүртгэлийг цуцална. */
  subscribe(fn: (c: GeoCoords) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isFallback(): boolean {
    return this.fallback;
  }

  getCoords(): GeoCoords {
    return { lat: this.lat, lng: this.lng };
  }

  calcDistance(h: Hospital): number {
    return h.getDistance(this.getCoords());
  }

  sortByDistance(hs: Hospital[]): Hospital[] {
    return Hospital.searchNearby(hs, this.lat, this.lng);
  }

  /** Серверээс шүүлттэй эмнэлгүүд (тохирох мэргэжил → зай гэж сервер эрэмбэлнэ). */
  async searchNearby(f: HospitalFilter = {}, at: GeoCoords = this.getCoords()): Promise<Hospital[]> {
    const q = new URLSearchParams({ lat: String(at.lat), lng: String(at.lng) });
    if (f.specialty) q.set("specialty", f.specialty);
    if (f.emergency) q.set("emergency", "true");
    f.prioritize?.forEach((p) => q.append("prioritize", p));
    const r = await this.apiCtl.get<{ hospitals: HospitalDTO[] }>(`/api/hospitals?${q}`);
    return r.hospitals.map(Hospital.fromDTO);
  }

  private requestGps(): Promise<GeoCoords> {
    return new Promise((resolve) => {
      if (this.gpsRequested && !this.fallback) return resolve(this.getCoords());
      this.gpsRequested = true;
      navigator.geolocation.getCurrentPosition(
        (p) => {
          this.lat = p.coords.latitude;
          this.lng = p.coords.longitude;
          this.fallback = false;
          const c = this.getCoords();
          this.listeners.forEach((fn) => fn(c));
          resolve(c);
        },
        () => resolve(this.getCoords()),
        { timeout: 8000, maximumAge: 300_000 },
      );
    });
  }
}

// ─────────────────────────────────────────────────────────────── BookingController
export class BookingController {
  private selectedDoctor: Doctor | null = null;
  private selectedSlot: TimeSlot | null = null;

  constructor(
    private readonly location: LocationController = new LocationController(),
    private readonly apiCtl: ApiController = api,
  ) {}

  /** Хамгийн өндөр (бага биш) эрсдэлийн мэргэжил; бүгд бага бол дотрын эмч. */
  recommendSpecialty(r: RiskResult): Specialty {
    return r.getSpecialties()[0] ?? Specialty.byName("Дотоод шүүрэл");
  }

  /** Тухайн мэргэжлийн эмч нарыг эмнэлгийн зайгаар эрэмбэлж буцаана. */
  async findDoctors(s: Specialty, loc?: GeoCoords): Promise<Doctor[]> {
    const at = loc ?? (await this.location.getCurrentPos());
    const hospitals = Hospital.searchNearby(await this.location.searchNearby({ specialty: s.name }, at), at.lat, at.lng);
    return hospitals.flatMap((h) => h.getDoctors(s));
  }

  selectDoctor(d: Doctor): void {
    this.selectedDoctor = d;
    this.selectedSlot = null;
  }

  /** Серверээс хуваарь татаж эмчийн schedule-д нэгтгээд сул цагийг буцаана. */
  async getFreeSlots(d: Doctor, date: string): Promise<TimeSlot[]> {
    const rows = await this.apiCtl.get<{ time: string; available: boolean }[]>(
      `/api/hospitals/${encodeURIComponent(d.hospital.id)}/slots?day=${date}&specialty=${encodeURIComponent(d.specialty.name)}`);
    d.mergeSchedule(date, rows);
    return d.getFreeSlots(date);
  }

  selectSlot(s: TimeSlot): void {
    if (!s.isFree()) throw new Error("Энэ цаг сул биш байна.");
    this.selectedSlot = s;
  }

  checkDuplicate(candidate: Booking, existing: Booking[]): boolean {
    return candidate.isDuplicate(existing);
  }

  /**
   * book(u, slot, a) — захиалга үүсгэнэ. Сервер давхардлыг эцэслэн шалгаж (409), ТЗ-XXXX код олгоно.
   * u = null бол нэргүй захиалга. share = true үед зөвхөн эрсдэлийн хураангуйг эмнэлэгт дамжуулна.
   */
  async book(
    u: User | null,
    slot: TimeSlot | null,
    a: Assessment | null,
    patient: { name: string; phone: string },
    share = false,
  ): Promise<Booking> {
    const doctor = this.selectedDoctor;
    const s = slot ?? this.selectedSlot;
    if (!doctor || !s) throw new Error("Эмч болон цагаа сонгоно уу.");
    const r = await this.apiCtl.post<{ id: string; code: string; status: Booking["status"]; created_at: string }>("/api/bookings", {
      hospital_id: doctor.hospital.id, specialty: doctor.specialty.name, date: s.date, time: s.startTime,
      name: patient.name, phone: patient.phone, assessment_id: a && !a.isOffline() ? a.id : undefined,
      share_assessment: share,
    });
    s.reserve();
    const booking = new Booking(r.id, r.code, r.status, doctor.specialty.name, new Date(r.created_at), s, doctor, patient, a, u);
    a?.bookings.push(booking);
    u?.addBooking(booking);
    return booking;
  }

  /** Эмнэлгийн ажилтан баталгаажуулна. */
  async confirm(b: Booking): Promise<void> {
    if (b.status !== "pending") throw new Error("Зөвхөн хүлээгдэж буй захиалгыг батална.");
    await this.apiCtl.patch(`/api/staff/bookings/${b.id}`, { status: "confirmed", note: b.staff_note });
    b.confirm();
  }

  /** Код + утсаар цуцална — нэвтрээгүй захиалагч ч цуцалж чадна. */
  async cancel(b: Booking): Promise<void> {
    if (!b.isActive()) throw new Error("Энэ захиалга идэвхгүй байна.");
    await this.apiCtl.post("/api/bookings/cancel", { code: b.code, phone: b.patient.phone });
    b.cancel();
  }
}
