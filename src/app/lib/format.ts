import type { Level } from "./types";

export const LEVEL_STYLE: Record<Level, { text: string; bg: string; ring: string; label: string; hex: string }> = {
  low: { text: "text-risk-low", bg: "bg-green-50", ring: "ring-green-200", label: "Бага", hex: "#16a34a" },
  moderate: { text: "text-risk-moderate", bg: "bg-amber-50", ring: "ring-amber-200", label: "Дунд", hex: "#d97706" },
  high: { text: "text-risk-high", bg: "bg-red-50", ring: "ring-red-200", label: "Өндөр", hex: "#dc2626" },
};

export const levelOf = (v: number): Level => (v >= 50 ? "high" : v >= 20 ? "moderate" : "low");

export const pct = (v: number) => (v < 1 && v > 0 ? "<1%" : `${Math.round(v)}%`);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit" });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export const BOOKING_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Хүлээгдэж буй", cls: "bg-amber-100 text-amber-800" },
  confirmed: { label: "Баталгаажсан", cls: "bg-green-100 text-green-800" },
  cancelled: { label: "Цуцлагдсан", cls: "bg-gray-100 text-gray-600" },
  completed: { label: "Үзүүлсэн", cls: "bg-blue-100 text-blue-800" },
  no_show: { label: "Ирээгүй", cls: "bg-red-100 text-red-700" },
};

export const SPECIALTIES = ["Зүрх судас", "Дотоод шүүрэл", "Уушги, амьсгалын зам", "Хавдар судлал"];

export const ALGO_LABEL: Record<string, string> = {
  LogisticRegression: "Логистик регресс",
  "LogisticRegression-L2": "Логистик регресс (L2)",
  "LogisticRegression-Strong": "Логистик регресс (хүчтэй L2)",
  RandomForest: "Random Forest",
  "RandomForest-Monotone": "Random Forest (монотон)",
  GradientBoosting: "Gradient Boosting",
  XGBoost: "XGBoost",
};
