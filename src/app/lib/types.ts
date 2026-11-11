export type Level = "low" | "moderate" | "high";
export type Role = "user" | "staff" | "admin";

export interface Answers {
  age: number;
  gender: "male" | "female";
  height: number;
  weight: number;
  bp_systolic: number;
  smoking: "never" | "former" | "current";
  alcohol_freq: "never" | "seldom" | "often" | "daily";
  salt_intake: number;
  air_pollution: number;
  activity: "low" | "moderate" | "high";
  fruit_veg: "rare" | "some" | "daily";
  cholesterol: "unknown" | "normal" | "borderline" | "high";
  blood_sugar: "unknown" | "normal" | "high";
  family_history: string[];
  symptoms: string[];
  body_parts: string[];
  notes: string;
}

export interface Factor {
  feature: string;
  label: string;
  impact: number;
  source: "ml" | "odds_ratio";
}

export interface DiseaseRisk {
  label: string;
  value: number;
  baseline: number;
  level: Level;
  level_label: string;
  factors: Factor[];
  algorithm: string;
  kind: "probability" | "relative_index";
}

export interface RiskResult {
  model_version: string;
  bmi: number;
  bmi_category: { key: string; label: string };
  in_scope: boolean;
  scope_message?: string;
  red_flags: string[];
  urgent: boolean;
  risks?: Record<"heart" | "diabetes" | "cancer", DiseaseRisk>;
  overall?: { value: number; level: Level; level_label: string };
  radar?: { axis: string; value: number }[];
  reasons?: string[];
  specialties?: string[];
  offline?: boolean;
}

export interface Advice {
  text: string;
  provider: "gemini" | "ollama" | "template" | "rule";
  sources: { content: string; source: string; category: string }[];
  disclaimer: string;
}

export interface Assessment {
  id: string;
  created_at: string;
  user_id?: string | null;
  answers: Answers;
  result: RiskResult;
  advice: Advice | null;
}

export interface AssessmentSummary {
  id: string;
  created_at: string;
  model_version: string;
  overall: { value: number; level: Level } | null;
  scores: Record<string, number> | null;
  bmi: number;
  urgent: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: Role;
  hospital_id?: string;
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  hours: string;
  isEmergency: boolean;
  type: "Public" | "Private";
  specialties: string[];
  openTime: string;
  closeTime: string;
  active?: boolean;
  distance_km?: number;
  open_now?: boolean;
  match?: number;
  needs_verification?: boolean;
}

export interface Booking {
  id: string;
  code: string;
  hospital_id: string;
  hospital_name: string;
  specialty: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  shared_assessment?: { scores: Record<string, number>; overall: { value: number; level: Level }; bmi: number; urgent: boolean } | null;
  staff_note?: string;
  created_at: string;
}
