/**
 * «control» классууд — "Өргөтгөсөн класс диаграм (Boundary + Control + Entity)"-ын дагуу.
 * Boundary (UI) нь Entity-д шууд хандахгүй; зөвхөн эдгээр Control-оор дамжина.
 *
 *   AuthController    ──▶ ApiController, User
 *   SessionController ──▶ Assessment
 *   BookingController ──▶ LocationController, Specialty, Doctor, TimeSlot, Booking, Hospital
 *   LocationController──▶ Hospital
 */
import { api, ApiController } from "./ApiController";
import { Assessment, Booking, Doctor, Hospital, RiskResult, Specialty, TimeSlot, User } from "./entities";

export interface GeoCoords { lat: number; lng: number }

// ─────────────────────────────────────────────────────────────── AuthController
export class AuthController {
  private currentUser: User | null = null;
  private ready = false;

  constructor(private readonly apiCtl: ApiController = api) {}

  async login(email: string, pw: string): Promise<User> {
    this.currentUser = await User.login(email, pw);
    return this.currentUser;
  }

  async register(data: { email: string; password: string; name: string; phone?: string; consent: boolean }): Promise<User> {
    if (!data.consent) throw new Error("Нууцлалын бодлогыг зөвшөөрөх шаардлагатай.");
    this.currentUser = await User.register(data);
    return this.currentUser;
  }

  logout(): void {
    this.currentUser?.logout();
    this.currentUser = null;
  }

  /** Хадгалсан токеноор хэрэглэгчийг сэргээнэ (хуудас дахин ачаалахад). */
  async getUser(): Promise<User | null> {
    if (!this.ready) {
      this.ready = true;
      if (this.apiCtl.hasToken()) {
        try {
          this.currentUser = User.fromDTO(await this.apiCtl.get("/api/auth/me"));
        } catch {
          this.apiCtl.clearToken();
        }
      }
    }
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

// ─────────────────────────────────────────────────────────────── LocationController
const UB_CENTER: GeoCoords = { lat: 47.9188, lng: 106.9176 };

export class LocationController {
  private lat = UB_CENTER.lat;
  private lng = UB_CENTER.lng;
  private fallback = true;

  /** GPS байршил; зөвшөөрөхгүй бол Улаанбаатарын төв. */
  getCurrentPos(timeoutMs = 6000): Promise<GeoCoords> {
    return new Promise((resolve) => {
      const done = (c: GeoCoords, fb: boolean) => {
        this.lat = c.lat; this.lng = c.lng; this.fallback = fb;
        resolve(c);
      };
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) return done(UB_CENTER, true);
      navigator.geolocation.getCurrentPosition(
        (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }, false),
        () => done(UB_CENTER, true),
        { timeout: timeoutMs },
      );
    });
  }

  isFallback(): boolean {
    return this.fallback;
  }

  getCoords(): GeoCoords {
    return { lat: this.lat, lng: this.lng };
  }

  calcDistance(h: Hospital): number {
    return h.getDistance({ lat: this.lat, lng: this.lng });
  }

  sortByDistance(hs: Hospital[]): Hospital[] {
    return [...hs].sort((a, b) => this.calcDistance(a) - this.calcDistance(b));
  }
}

// ─────────────────────────────────────────────────────────────── BookingController
export class BookingController {
  private selectedDoctor: Doctor | null = null;
  private selectedSlot: TimeSlot | null = null;

  constructor(private readonly location: LocationController = new LocationController()) {}

  /** Хамгийн өндөр (бага биш) эрсдэлийн мэргэжил; бүгд бага бол дотрын эмч. */
  recommendSpecialty(r: RiskResult): Specialty {
    return r.getSpecialties()[0] ?? Specialty.byName("Дотоод шүүрэл");
  }

  /** Тухайн мэргэжлийн эмч нарыг эмнэлгийн зайгаар эрэмбэлж буцаана. */
  async findDoctors(s: Specialty, loc?: GeoCoords): Promise<Doctor[]> {
    const pos = loc ?? (await this.location.getCurrentPos());
    const hospitals = this.location.sortByDistance(await Hospital.searchNearby(pos.lat, pos.lng));
    return hospitals.flatMap((h) => h.getDoctors(s));
  }

  selectDoctor(d: Doctor): void {
    this.selectedDoctor = d;
    this.selectedSlot = null;
  }

  async getFreeSlots(d: Doctor, date: string): Promise<TimeSlot[]> {
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
   * Захиалга үүсгэнэ. Сервер давхардлыг эцэслэн шалгаж (409), ТЗ-XXXX код олгоно.
   * shareAssessment = true үед зөвхөн эрсдэлийн хураангуйг эмнэлэгт дамжуулна.
   */
  async book(
    patient: { name: string; phone: string },
    slot: TimeSlot | null = this.selectedSlot,
    a: Assessment | null = null,
    shareAssessment = false,
  ): Promise<Booking> {
    const doctor = this.selectedDoctor;
    if (!doctor || !slot) throw new Error("Эмч болон цагаа сонгоно уу.");
    const r = await api.post<{ id: string; code: string; status: Booking["status"]; created_at: string }>("/api/bookings", {
      hospital_id: doctor.hospital.id, specialty: doctor.specialty.name, date: slot.date, time: slot.startTime,
      name: patient.name, phone: patient.phone, assessment_id: a?.id, share_assessment: shareAssessment,
    });
    slot.reserve();
    const booking = new Booking(r.id, r.code, r.status, doctor.specialty.name, new Date(r.created_at), slot, doctor, patient, a);
    a?.bookings.push(booking);
    return booking;
  }
}
