/**
 * «entity» классууд — "EOTOCH — Шинжилгээний класс диаграм"-ын дагуу.
 *
 * Зарчим: Entity нь ЦЭВЭР — сервер, localStorage, GPS руу хандахгүй; зөвхөн өгөгдөл ба
 * бизнесийн дүрэм. Сервертэй харилцах бүх ажлыг Control классууд (controllers.ts) хийнэ.
 * Ингэснээр хамаарал диаграмын дагуу Boundary → Control → Entity чиглэлтэй байна.
 *
 * Холбоосууд (диаграм → код):
 *   User      ◆1 ── 0..* Assessment   user.assessments          (composition)
 *   User       1 ── 0..* Booking      user.bookings / booking.user
 *   Assessment◆1 ── 1    Answers      assessment.answers        (composition)
 *   Assessment◆1 ── 1    RiskResult   assessment.result         (composition)
 *   Assessment 1 ── 0..1 Advice       assessment.advice
 *   Assessment 0..1 ── 0..* Booking   "хуваалцана"  booking.assessment / assessment.bookings
 *   RiskResult◆1 ── 0..3 DiseaseRisk  result.risks              (composition)
 *   DiseaseRisk◇1 ── 0..* Factor      risk.factors              (aggregation)
 *   DiseaseRisk 0..* ── 1 Specialty   "зөвлөнө"     risk.getSpecialty()
 *   Specialty  1 ── 0..* Doctor       "мэргэшсэн"   specialty.doctors / doctor.specialty
 *   Doctor    ◆1 ── 0..* TimeSlot     "хуваарь"     doctor.schedule (composition)
 *   Hospital  ◇1 ── 1..* Doctor       "ажилладаг"   hospital.doctors / doctor.hospital
 *   Booking 0..1 ── 1 TimeSlot        "захиална"    booking.slot
 */
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

  getProfile(): User {
    return this;
  }

  /** Composition: хэрэглэгчийн үнэлгээг (давхардуулахгүй) эзэмшилд нэмнэ. */
  addAssessment(a: Assessment): void {
    const i = this.assessments.findIndex((x) => x.id === a.id);
    if (i >= 0) this.assessments[i] = a;
    else this.assessments.unshift(a);
  }

  addBooking(b: Booking): void {
    if (!this.bookings.some((x) => x.id === b.id)) this.bookings.unshift(b);
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
      (this.gender === "male" || this.gender === "female") &&
      this.height >= 100 && this.height <= 220 &&
      this.weight >= 30 && this.weight <= 200 &&
      this.bp_systolic >= 80 && this.bp_systolic <= 220 &&
      ["never", "former", "current"].includes(this.smoking)
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

/**
 * Нэг мэргэжилд нэг л объект (registry). Ингэснээр RiskResult-аас авсан Specialty
 * болон эмнэлгээс ачаалсан эмч нар ижил объектыг заана → getDoctors() бодит жагсаалт буцаана.
 */
export class Specialty {
  private static readonly registry = new Map<string, Specialty>();
  readonly doctors: Doctor[] = []; // "мэргэшсэн" 1 ── 0..*

  private constructor(readonly id: string, readonly name: string, readonly diseaseKey: DiseaseKey | null) {}

  static forDisease(key: DiseaseKey): Specialty {
    return Specialty.byName(DISEASE_SPECIALTY[key]);
  }

  static byName(name: string): Specialty {
    let s = Specialty.registry.get(name);
    if (!s) {
      const key = (Object.keys(DISEASE_SPECIALTY) as DiseaseKey[]).find((k) => DISEASE_SPECIALTY[k] === name) ?? null;
      s = new Specialty(key ?? name, name, key);
      Specialty.registry.set(name, s);
    }
    return s;
  }

  /** Ижил ID-тай эмч дахин ачаалагдвал шинэ объектоор солино (давхардахгүй). */
  addDoctor(d: Doctor): void {
    const i = this.doctors.findIndex((x) => x.id === d.id);
    if (i >= 0) this.doctors[i] = d;
    else this.doctors.push(d);
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

  private constructor(
    readonly model_version: string,
    readonly bmi: number,
    readonly bmi_category: string,
    readonly red_flags: string[],
    readonly urgent: boolean,
    readonly overall: { value: number; level: Level; level_label: string } | null,
    readonly risks: DiseaseRisk[], // composition 0..3
    /** UI-д хэрэгтэй нэмэлт мэдээлэл (диаграмын үндсэн атрибутаас гадна) */
    readonly in_scope: boolean,
    readonly scope_message: string | undefined,
    readonly radar: { axis: string; value: number }[],
    readonly reasons: string[],
    readonly offline: boolean,
    private readonly dto: DTO.RiskResult, // заавал — toJSON() хэзээ ч undefined буцаахгүй
  ) {}

  static fromDTO(d: DTO.RiskResult): RiskResult {
    const risks = Object.entries(d.risks ?? {}).map(([k, r]) => new DiseaseRisk(
      k as DiseaseKey, r.label, r.value, r.baseline, r.level,
      r.factors.map((f) => new Factor(f.feature, f.label, f.impact, f.source)), r.algorithm, r.level_label, r.kind));
    return new RiskResult(d.model_version, d.bmi, d.bmi_category.label, d.red_flags, d.urgent, d.overall ?? null, risks,
      d.in_scope, d.scope_message, d.radar ?? [], d.reasons ?? [], d.offline ?? false, d);
  }

  toJSON(): DTO.RiskResult {
    return this.dto;
  }

  getRisk(key: DiseaseKey): DiseaseRisk | undefined {
    return this.risks.find((r) => r.key === key);
  }

  /**
   * Нийт эрсдэлийн түвшин. Оноо тооцоогүй (нас 15–65-аас гадуур) бол `null` —
   * "эрсдэл бага" гэж худлаа хэлэхгүй.
   */
  getLevel(): Level | null {
    if (!this.in_scope || this.risks.length === 0) return null;
    if (this.overall) return this.overall.level;
    return levelOf(Math.max(...this.risks.map((r) => r.value)));
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
    if (this.dto.specialties?.length) return this.dto.specialties.map(Specialty.byName);
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
    /** Эзэмшигч хэрэглэгч; нэвтрээгүй хийсэн бол null */
    readonly userId: string | null = null,
  ) {}

  static fromDTO(d: DTO.Assessment): Assessment {
    return new Assessment(d.id, new Date(d.created_at), Answers.fromDTO(d.answers), RiskResult.fromDTO(d.result),
      d.advice ? Advice.fromDTO(d.advice) : null, d.user_id ?? null);
  }

  /** Серверт хадгалагдаагүй, браузер дотор (ONNX) тооцоолсон үнэлгээ. */
  static offline(answers: Answers, result: DTO.RiskResult): Assessment {
    return new Assessment("offline", new Date(), answers, RiskResult.fromDTO(result), null);
  }

  toJSON(): DTO.Assessment {
    return { id: this.id, created_at: this.created_at.toISOString(), answers: this.answers.toJSON(),
      result: this.result.toJSON(), advice: this.advice, user_id: this.userId };
  }

  isOffline(): boolean {
    return this.id === "offline";
  }

  getResult(): RiskResult {
    return this.result;
  }

  getAdvice(): Advice | null {
    return this.advice;
  }

  /** Шинэ зөвлөгөөтэй хуулбар (immutable). */
  withAdvice(advice: Advice): Assessment {
    return new Assessment(this.id, this.created_at, this.answers, this.result, advice, this.userId);
  }

  withOwner(userId: string): Assessment {
    return new Assessment(this.id, this.created_at, this.answers, this.result, this.advice, userId);
  }

  /** Өгөгдсөн жагсаалтаас тухайн хэрэглэгчийнхийг шинээс хуучин руу. */
  static listByUser(all: Assessment[], uid: string): Assessment[] {
    return all.filter((a) => a.userId === uid).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
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

  /** 30 минутын слот үүсгэнэ. ID нь эмч + огноо + цагаар тогтмол → дахин ачаалахад ижил. */
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

  /**
   * Серверээс ирсэн хуваарийг нэгтгэнэ. Ижил ID-тай слот байвал ШИНЭ объект үүсгэхгүй,
   * байгаа объектын төлөвийг шинэчилнэ → Booking.slot хуваарьтай үргэлж нэг объект.
   */
  mergeSchedule(date: string, rows: { time: string; available: boolean }[]): void {
    const incoming = new Set<string>();
    for (const r of rows) {
      const fresh = TimeSlot.of(this.id, date, r.time, !r.available);
      incoming.add(fresh.id);
      const existing = this.schedule.find((s) => s.id === fresh.id);
      if (!existing) this.schedule.push(fresh);
      else if (r.available && existing.isBooked) existing.release();
      else if (!r.available && existing.isFree()) existing.reserve();
    }
    // тухайн өдрийн серверт байхгүй болсон слотыг хасна
    for (let i = this.schedule.length - 1; i >= 0; i--) {
      const s = this.schedule[i];
      if (s.date === date && !incoming.has(s.id)) this.schedule.splice(i, 1);
    }
    this.schedule.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  }

  /** Тухайн өдрийн сул цагууд (ачаалсан хуваариас). */
  getFreeSlots(date: string): TimeSlot[] {
    return this.schedule.filter((s) => s.date === date && s.isFree());
  }

  getSchedule(date?: string): TimeSlot[] {
    return date ? this.schedule.filter((s) => s.date === date) : this.schedule;
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

  /** Өгөгдсөн байршлаас radiusKm дотор байгааг ойроос нь эрэмбэлнэ. */
  static searchNearby(all: Hospital[], lat: number, lng: number, radiusKm = Infinity): Hospital[] {
    return all
      .map((h) => ({ h, d: h.getDistance({ lat, lng }) }))
      .filter((x) => x.d <= radiusKm)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.h);
  }

  getDoctors(spec: Specialty): Doctor[] {
    return this.doctors.filter((d) => d.specialty === spec);
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
    readonly user: User | null = null,       // User 1 ── 0..* Booking (нэвтрээгүй бол null)
    public staff_note = "",
  ) {}

  get status(): BookingStatus {
    return this._status;
  }

  get specialty(): string {
    return this.doctor.specialty.name;
  }

  isActive(): boolean {
    return this._status === "pending" || this._status === "confirmed";
  }

  /** Төлөвийн дүрэм: зөвхөн хүлээгдэж буйг батална. */
  confirm(): void {
    if (this._status !== "pending") throw new Error("Зөвхөн хүлээгдэж буй захиалгыг батална.");
    this._status = "confirmed";
  }

  /** Цуцлахад слот чөлөөлөгдөнө. Идэвхгүй захиалгыг цуцлах боломжгүй. */
  cancel(): void {
    if (!this.isActive()) throw new Error("Энэ захиалга идэвхгүй байна.");
    this._status = "cancelled";
    this.slot.release();
  }

  /** Backend-тэй ижил дүрэм: (1) нэг слот давхар, (2) нэг утсаар нэг өдөр нэг эмнэлэгт давхар. */
  isDuplicate(existing: Booking[]): boolean {
    return existing.filter((b) => b.id !== this.id && b.isActive()).some((b) =>
      (b.doctor.id === this.doctor.id && b.slot.date === this.slot.date && b.slot.startTime === this.slot.startTime) ||
      (b.doctor.hospital.id === this.doctor.hospital.id && b.slot.date === this.slot.date && b.patient.phone === this.patient.phone));
  }
}
