/**
 * «boundary» интерфэйсүүд — хэрэглэгчтэй харилцах дэлгэцүүд.
 * React-д дэлгэц нь функц компонент тул класс биш интерфэйсээр (гэрээ) тодорхойлж,
 * аль файлд хэрэгжсэнийг заав. Boundary → Control чиглэлтэй dependency (тасархай сум).
 */
import type { Assessment, Booking, Doctor, Hospital, Specialty, TimeSlot } from "./entities";
import type { Answers } from "./entities";

/** pages/Assessment.tsx → ApiController, SessionController */
export interface AssessmentFormUI {
  render(): void;
  validateAnswers(a: Answers): boolean;
  submitAssessment(a: Answers): Promise<Assessment>;
  showProgress(step: number, total: number): void;
}

/** pages/Result.tsx → ApiController, SessionController */
export interface ResultUI {
  render(): void;
  displayRiskChart(a: Assessment): void;
  showRedFlags(flags: string[]): void;
  downloadReport(): void; // window.print() → A4 PDF
}

/** components/ChatAssistant.tsx → ApiController, SessionController */
export interface AIAdvisorUI {
  render(): void;
  sendMessage(text: string): Promise<void>;
  displayAdvice(text: string): void;
  toggleVoice(): void; // Web Speech API
}

/** pages/Hospitals.tsx → ApiController, LocationController */
export interface HospitalSearchUI {
  render(): void;
  searchByKeyword(q: string): void;
  filterBySpecialty(s: Specialty): void;
  filterByDistance(maxKm: number): void;
  openBooking(h: Hospital): void;
}

/** components/BookingDialog.tsx → BookingController */
export interface BookingUI {
  showRecommended(s: Specialty): void;
  selectDoctor(d: Doctor): void;
  showFreeSlots(d: Doctor, date: string): Promise<void>;
  selectSlot(s: TimeSlot): void;
  confirmBooking(): Promise<Booking>;
}

/** components/SOSDialog.tsx → LocationController */
export interface SOSUI {
  render(): void;
  triggerAlert(): void;
  showNearbyHospitals(): Promise<void>;
  callEmergency(): void; // tel:103
}
