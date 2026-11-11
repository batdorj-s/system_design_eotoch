/**
 * «entity» классууд — "EOTOCH — Шинжилгээний класс диаграм"-ын дагуу.
 *
 * Холбоосууд (диаграм → код):
 *   User      ◆1 ── 0..* Assessment   (composition: хэрэглэгч устахад үнэлгээ нь устна)
 *   User      1  ── 0..* Booking      (association)
 *   Assessment◆1 ── 1    Answers      (composition)
 *   Assessment◆1 ── 1    RiskResult   (composition)
 *   Assessment 1 ── 0..1 Advice       (association)
 *   Assessment 0..1 ── 0..* Booking   "хуваалцана" (эрсдэлийн хураангуйг эмнэлэгт)
 *   RiskResult◆1 ── 0..3 DiseaseRisk  (composition)
 *   DiseaseRisk◇1 ── 0..* Factor      (aggregation)
 *   DiseaseRisk 0..* ── 1 Specialty   "зөвлөнө"
 *   Specialty  1 ── 0..* Doctor       "мэргэшсэн"
 *   Doctor    ◆1 ── 0..* TimeSlot     "хуваарь" (composition)
 *   Hospital  ◇1 ── 1..* Doctor       "ажилладаг" (aggregation)
 *   Booking 0..1 ── 1 TimeSlot        "захиална"
 */
import { api } from "./ApiController";
import type * as DTO from "../lib/types";

export type Role = "user" | "staff" | "admin";
export type Level = "low" | "moderate" | "high";
export type DiseaseKey = "heart" | "diabetes" | "cancer";

const levelOf = (v: number): Level => (v >= 50 ? "high" : v >= 20 ? "moderate" : "low");

// ─────────────────────────────────────────────────────────────── User
export interface UserDTO { id: string; email: string; name: string; phone?: string; role: Role; hospital_id?: string }

export class User {
  readonly assessments: Assessment[] = []; // composition 0..*
  readonly bookings: Booking[] = [];       // association 0..*

  constructor(
    readonly id: string,
    readonly email: string,
    readonly name: string,
    readonly phone: string | undefined,
    readonly role: Role,
    readonly hospital_id?: string,
  ) {}

  static fromDTO(d: UserDTO): User {
    return new User(d.id, d.email, d.name, d.phone, d.role, d.hospital_id);
  }

  static async login(email: string, pw: string): Promise<User> {
    const r = await api.post<{ token: string; user: UserDTO }>("/api/auth/login", { email, password: pw });
    api.setToken(r.token);
    return User.fromDTO(r.user);
  }

  static async register(data: { email: string; password: string; name: string; phone?: string; consent: boolean }): Promise<User> {
    const r = await api.post<{ token: string; user: UserDTO }>("/api/auth/register", data);
    api.setToken(r.token);
    return User.fromDTO(r.user);
  }

  logout(): void {
    api.clearToken();
  }

  getProfile(): User {
    return this;
  }
}

// ─────────────────────────────────────────────────────────────── Answers
export class Answers {
  constructor(
    readonly age: number,
    readonly gender: "male" | "female",
    readonly height: number,
    readonly weight: number,
    readonly bp_systolic: number,
    readonly smoking: "never" | "former" | "current",
    readonly symptoms: string[] = [],
    /** Диаграмд заагаагүй ч асуулгад байдаг нэмэлт талбарууд (давс, хөдөлгөөн г.м.) */
    readonly extra: Record<string, unknown> = {},
  ) {}

  static fromDTO(d: DTO.Answers): Answers {
    const { age, gender, height, weight, bp_systolic, smoking, symptoms, ...extra } = d;
    return new Answers(age, gender, height, weight, bp_systolic, smoking, symptoms, extra);
  }

  /** Backend-ийн pydantic хязгаартай ижил шалгалт. */
  validate(): boolean {
    return (
      this.age >= 10 && this.age <= 100 &&
      this.height >= 100 && this.height <= 220 &&
      this.weight >= 30 && this.weight <= 200 &&
      this.bp_systolic >= 80 && this.bp_systolic <= 220
    );
  }

  /** BMI = жин(кг) / өндөр(м)² */
  calcBMI(): number {
    return Math.round((this.weight / (this.height / 100) ** 2) * 10) / 10;
  }

  toJSON(): DTO.Answers {
    const { age, gender, height, weight, bp_systolic, smoking, symptoms } = this;
    return { ...(this.extra as Omit<DTO.Answers, "age">), age, gender, height, weight, bp_systolic, smoking, symptoms };
  }
}

// ─────────────────────────────────────────────────────────────── Factor
export class Factor {
  constructor(
    readonly feature: string,
    readonly label: string,
    readonly impact: number, // SHAP хувь нэмэр, хувийн пунктээр (+ = эрсдэл нэмсэн)
    readonly source: "ml" | "odds_ratio",
  ) {}

  getImpact(): number {
    return this.impact;
  }
}

// ─────────────────────────────────────────────────────────────── Specialty
const DISEASE_SPECIALTY: Record<DiseaseKey, string> = {
  heart: "Зүрх судас",
  diabetes: "Дотоод шүүрэл",
  cancer: "Хавдар судлал",
};

export class Specialty {
  readonly doctors: Doctor[] = []; // "мэргэшсэн" 1 ── 0..*

  constructor(readonly id: string, readonly name: string, readonly diseaseKey: DiseaseKey | null) {}

  static forDisease(key: DiseaseKey): Specialty {
    return new Specialty(key, DISEASE_SPECIALTY[key], key);
  }

  static byName(name: string): Specialty {
    const key = (Object.keys(DISEASE_SPECIALTY) as DiseaseKey[]).find((k) => DISEASE_SPECIALTY[k] === name) ?? null;
    return new Specialty(key ?? name, name, key);
  }

  addDoctor(d: Doctor): void {
    if (!this.doctors.includes(d)) this.doctors.push(d);
  }

  getDoctors(): Doctor[] {
    return this.doctors;
  }
}

// ─────────────────────────────────────────────────────────────── DiseaseRisk
export class DiseaseRisk {
  constructor(
    readonly key: DiseaseKey,
    readonly label: string,
    readonly value: number,     // 0–100 %
    readonly baseline: number,  // дундаж хүний эрсдэл
    readonly level: Level,
    readonly factors: Factor[], // aggregation 0..*
    readonly algorithm: string,
    readonly level_label: string,
    readonly kind: "probability" | "relative_index",
  ) {}

  getFactors(): Factor[] {
    return [...this.factors].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  }

  /** "зөвлөнө" — энэ эрсдэлд аль мэргэжлийн эмчид хандахыг заана. */
  getSpecialty(): Specialty {
    return Specialty.forDisease(this.key);
  }
}

// ─────────────────────────────────────────────────────────────── RiskResult
export class RiskResult {
  static readonly URGENT_THRESHOLD = 85;

  constructor(
    readonly model_version: string,
    readonly bmi: number,
    readonly bmi_category: string,
    readonly red_flags: string[],
    readonly urgent: boolean,
    readonly overall: { value: number; level: Level; level_label: string } | null,
    readonly risks: DiseaseRisk[], // composition 0..3
    /** UI-д хэрэгтэй нэмэлт мэдээлэл (диаграмын үндсэн атрибутаас гадна) */
    readonly in_scope: boolean = true,
    readonly scope_message: string | undefined = undefined,
    readonly radar: { axis: string; value: number }[] = [],
    readonly reasons: string[] = [],
    readonly offline: boolean = false,
    private readonly dto?: DTO.RiskResult,
  ) {}

  static fromDTO(d: DTO.RiskResult): RiskResult {
    const risks = Object.entries(d.risks ?? {}).map(([k, r]) => new DiseaseRisk(
      k as DiseaseKey, r.label, r.value, r.baseline, r.level,
      r.factors.map((f) => new Factor(f.feature, f.label, f.impact, f.source)), r.algorithm, r.level_label, r.kind));
    return new RiskResult(d.model_version, d.bmi, d.bmi_category.label, d.red_flags, d.urgent, d.overall ?? null, risks,
      d.in_scope, d.scope_message, d.radar ?? [], d.reasons ?? [], d.offline ?? false, d);
  }

  toJSON(): DTO.RiskResult | undefined {
    return this.dto;
  }

  getRisk(key: DiseaseKey): DiseaseRisk | undefined {
    return this.risks.find((r) => r.key === key);
  }

  getLevel(): Level {
    if (this.overall) return this.overall.level;
    return levelOf(Math.max(0, ...this.risks.map((r) => r.value)));
  }

  /** Бизнесийн дүрэм: зүрх эсвэл хавдрын эрсдэл ≥ 85% эсвэл аюулын шинж тэмдэг байвал яаралтай. */
  isUrgent(): boolean {
    return this.urgent || this.red_flags.length > 0 || this.risks.some(
      (r) => (r.key === "heart" || r.key === "cancer") && r.value >= RiskResult.URGENT_THRESHOLD);
  }

  /**
   * Бага биш эрсдэлүүдийн мэргэжлийг өндрөөс нь эхлэн. Сервер нэмэлт мэргэжил
   * (жишээ нь тамхи/агаарын бохирдол → "Уушги, амьсгалын зам") санал болгосон бол түүнийг ашиглана.
   */
  getSpecialties(): Specialty[] {
    if (this.dto?.specialties?.length) return this.dto.specialties.map(Specialty.byName);
    return [...this.risks].filter((r) => r.level !== "low").sort((a, b) => b.value - a.value).map((r) => r.getSpecialty());
  }
}

// ─────────────────────────────────────────────────────────────── Advice
export class Advice {
  constructor(
    readonly text: string,
    readonly provider: DTO.Advice["provider"],
    readonly sources: DTO.Advice["sources"],
    readonly disclaimer: string,
  ) {}

  static fromDTO(d: DTO.Advice): Advice {
    return new Advice(d.text, d.provider, d.sources, d.disclaimer);
  }

  getText(): string {
    return `${this.text}\n\n${this.disclaimer}`;
  }

  getSources(): DTO.Advice["sources"] {
    return this.sources;
  }
}

// ─────────────────────────────────────────────────────────────── Assessment
export class Assessment {
  readonly bookings: Booking[] = []; // "хуваалцана" 0..*

  constructor(
    readonly id: string,
    readonly created_at: Date,
    readonly answers: Answers,      // composition 1
    readonly result: RiskResult,    // composition 1
    readonly advice: Advice | null, // association 0..1
  ) {}

  static fromDTO(d: DTO.Assessment): Assessment {
    return new Assessment(d.id, new Date(d.created_at), Answers.fromDTO(d.answers), RiskResult.fromDTO(d.result),
      d.advice ? Advice.fromDTO(d.advice) : null);
  }

  toJSON(): DTO.Assessment {
    return { id: this.id, created_at: this.created_at.toISOString(), answers: this.answers.toJSON(),
      result: this.result.toJSON()!, advice: this.advice };
  }

  /** Шинэ үнэлгээ илгээж, серверээс эрсдэл + SHAP тайлбар + зөвлөгөө авна. */
  static async create(answers: Answers): Promise<Assessment> {
    if (!answers.validate()) throw new Error("Асуулгын утга хүрээнээс гадуур байна.");
    return Assessment.fromDTO(await api.post<DTO.Assessment>("/api/assessments", { answers: answers.toJSON(), consent: true }));
  }

  /** Серверт хадгалагдаагүй, браузер дотор (ONNX) тооцоолсон үнэлгээ. */
  static offline(answers: Answers, result: DTO.RiskResult): Assessment {
    return new Assessment("offline", new Date(), answers, RiskResult.fromDTO(result), null);
  }

  static async load(id: string): Promise<Assessment> {
    return Assessment.fromDTO(await api.get<DTO.Assessment>(`/api/assessments/${encodeURIComponent(id)}`));
  }

  /** Зөвлөгөөг AI-аар дахин үүсгэнэ (Gemini ажиллахгүй байсан бол). */
  async regenerateAdvice(): Promise<Assessment> {
    const adv = Advice.fromDTO(await api.post<DTO.Advice>(`/api/assessments/${this.id}/advice`));
    return new Assessment(this.id, this.created_at, this.answers, this.result, adv);
  }

  /** Нэргүй хийсэн үнэлгээг нэвтэрсэн хэрэглэгчийн түүхэнд нэмнэ. */
  async claim(): Promise<boolean> {
    return (await api.post<{ claimed: boolean }>(`/api/me/assessments/${this.id}/claim`)).claimed;
  }

  getResult(): RiskResult {
    return this.result;
  }

  getAdvice(): Advice | null {
    return this.advice;
  }

  /** Хэрэглэгчийн түүх (нэвтэрсэн токеноор). */
  static async listByUser(_uid: string): Promise<DTO.AssessmentSummary[]> {
    return api.get("/api/me/assessments");
  }
}

// ─────────────────────────────────────────────────────────────── TimeSlot
export class TimeSlot {
  constructor(
    readonly id: string,
    readonly date: string,      // YYYY-MM-DD
    readonly startTime: string, // HH:MM
    readonly endTime: string,
    private booked: boolean,
  ) {}

  /** 30 минутын слот үүсгэнэ. */
  static of(doctorId: string, date: string, start: string, booked = false): TimeSlot {
    const [h, m] = start.split(":").map(Number);
    const end = h * 60 + m + 30;
    const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
    return new TimeSlot(`${doctorId}@${date}T${start}`, date, start, endTime, booked);
  }

  get isBooked(): boolean {
    return this.booked;
  }

  reserve(): void {
    if (this.booked) throw new Error("Энэ цаг аль хэдийн захиалагдсан.");
    this.booked = true;
  }

  release(): void {
    this.booked = false;
  }

  isFree(): boolean {
    return !this.booked;
  }
}

// ─────────────────────────────────────────────────────────────── Doctor
export class Doctor {
  private readonly schedule: TimeSlot[] = []; // composition "хуваарь" 0..*

  constructor(
    readonly id: string,
    readonly name: string,
    readonly title: string,
    readonly roomNo: string,
    readonly specialty: Specialty,
    readonly hospital: Hospital,
  ) {}

  /** Тухайн өдрийн сул цагууд — серверийн /slots endpoint-оос. */
  async getFreeSlots(date: string): Promise<TimeSlot[]> {
    const rows = await api.get<{ time: string; available: boolean }[]>(
      `/api/hospitals/${encodeURIComponent(this.hospital.id)}/slots?day=${date}&specialty=${encodeURIComponent(this.specialty.name)}`);
    const slots = rows.map((r) => TimeSlot.of(this.id, date, r.time, !r.available));
    this.schedule.splice(0, this.schedule.length, ...this.schedule.filter((s) => s.date !== date), ...slots);
    return slots.filter((s) => s.isFree());
  }

  getSchedule(): TimeSlot[] {
    return this.schedule;
  }
}

// ─────────────────────────────────────────────────────────────── Hospital
export type HospitalDTO = DTO.Hospital;
export interface HospitalFilter { specialty?: string; emergency?: boolean; prioritize?: string[] }

export class Hospital {
  readonly doctors: Doctor[] = []; // aggregation "ажилладаг" 1..*

  constructor(
    readonly id: string,
    readonly name: string,
    readonly address: string,
    readonly lat: number,
    readonly lng: number,
    readonly phone: string,
    readonly isEmergency: boolean,
    readonly type: string,
    readonly hours: string = "",
    readonly specialties: string[] = [],
    readonly open_now: boolean = false,
    /** Хэрэглэгчийн эрсдэлд тохирох мэргэжлийн тоо (сервер эрэмбэлэхэд ашигладаг) */
    readonly match: number = 0,
    readonly needs_verification: boolean = false,
  ) {}

  /**
   * Одоогийн backend эмч тус бүрийг хадгалдаггүй тул мэргэжил бүрт нэг
   * "эмчийн хуваарь" (Doctor) үүсгэнэ. Эмчийн бүртгэл нэмэгдвэл энд солигдоно.
   */
  static fromDTO(d: HospitalDTO): Hospital {
    const h = new Hospital(d.id, d.name, d.address, d.lat, d.lng, d.phone, d.isEmergency, d.type, d.hours,
      d.specialties, d.open_now ?? false, d.match ?? 0, d.needs_verification ?? false);
    d.specialties.forEach((name, i) => {
      const spec = Specialty.byName(name);
      const doc = new Doctor(`${d.id}:${spec.id}`, `${name} эмч`, "Их эмч", `${101 + i}`, spec, h);
      spec.addDoctor(doc);
      h.doctors.push(doc);
    });
    return h;
  }

  /** Сервер шүүж, тохирох мэргэжил → зайгаар эрэмбэлж буцаана. */
  static async searchNearby(lat: number, lng: number, f: HospitalFilter = {}): Promise<Hospital[]> {
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (f.specialty) q.set("specialty", f.specialty);
    if (f.emergency) q.set("emergency", "true");
    f.prioritize?.forEach((p) => q.append("prioritize", p));
    const r = await api.get<{ hospitals: HospitalDTO[] }>(`/api/hospitals?${q}`);
    return r.hospitals.map(Hospital.fromDTO);
  }

  getDoctors(spec: Specialty): Doctor[] {
    return this.doctors.filter((d) => d.specialty.name === spec.name);
  }

  /** Haversine томьёо — км. */
  getDistance(loc: { lat: number; lng: number }): number {
    const R = 6371;
    const rad = (x: number) => (x * Math.PI) / 180;
    const dLat = rad(this.lat - loc.lat);
    const dLng = rad(this.lng - loc.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(loc.lat)) * Math.cos(rad(this.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}

// ─────────────────────────────────────────────────────────────── Booking
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export class Booking {
  constructor(
    readonly id: string,
    readonly code: string, // ТЗ-XXXX
    private _status: BookingStatus,
    readonly reason: string,
    readonly created_at: Date,
    readonly slot: TimeSlot,                 // "захиална" 1
    readonly doctor: Doctor,
    readonly patient: { name: string; phone: string },
    readonly assessment: Assessment | null,  // "хуваалцана" 0..1
    public staff_note = "",
  ) {}

  get status(): BookingStatus {
    return this._status;
  }

  get specialty(): string {
    return this.doctor.specialty.name;
  }

  /** Эмнэлгийн ажилтан баталгаажуулна. */
  async confirm(): Promise<void> {
    if (this._status !== "pending") throw new Error("Зөвхөн хүлээгдэж буй захиалгыг батална.");
    await api.patch(`/api/staff/bookings/${this.id}`, { status: "confirmed", note: this.staff_note });
    this._status = "confirmed";
  }

  /** Хэрэглэгч цуцлахад слот чөлөөлөгдөнө. */
  async cancel(): Promise<void> {
    if (this._status !== "pending" && this._status !== "confirmed") return;
    await api.post(`/api/me/bookings/${this.id}/cancel`);
    this._status = "cancelled";
    this.slot.release();
  }

  /** Backend-тэй ижил дүрэм: (1) нэг слот давхар, (2) нэг утсаар нэг өдөр нэг эмнэлэгт давхар. */
  isDuplicate(existing: Booking[]): boolean {
    const active = (b: Booking) => b.id !== this.id && (b.status === "pending" || b.status === "confirmed");
    return existing.filter(active).some((b) =>
      (b.doctor.id === this.doctor.id && b.slot.date === this.slot.date && b.slot.startTime === this.slot.startTime) ||
      (b.doctor.hospital.id === this.doctor.hospital.id && b.slot.date === this.slot.date && b.patient.phone === this.patient.phone));
  }
}
