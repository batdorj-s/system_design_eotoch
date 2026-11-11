const PARTS = [
  { id: "head", name: "Толгой", d: "M150 18c22 0 36 17 36 38s-14 40-36 40-36-19-36-40 14-38 36-38z" },
  { id: "chest", name: "Цээж", d: "M104 104h92c10 0 16 8 16 18v58H88v-58c0-10 6-18 16-18z" },
  { id: "stomach", name: "Хэвлий", d: "M88 184h124v62c0 10-7 16-16 16H104c-9 0-16-6-16-16z" },
  { id: "left-arm", name: "Зүүн гар", d: "M84 108c-14 4-22 14-24 28l-12 96c-1 8 12 10 14 2l18-82z" },
  { id: "right-arm", name: "Баруун гар", d: "M216 108c14 4 22 14 24 28l12 96c1 8-12 10-14 2l-18-82z" },
  { id: "left-leg", name: "Зүүн хөл", d: "M100 266h44l-6 150c0 10-26 10-26 0z" },
  { id: "right-leg", name: "Баруун хөл", d: "M156 266h44l-12 150c0 10-26 10-26 0z" },
];

export function BodyMap({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="grid gap-6 sm:grid-cols-[220px_1fr] items-center">
      <svg viewBox="0 0 300 430" className="mx-auto w-full max-w-[220px]" role="group" aria-label="Биеийн зураг">
        {PARTS.map((p) => {
          const on = value.includes(p.id);
          return (
            <path
              key={p.id}
              d={p.d}
              role="checkbox"
              aria-checked={on}
              aria-label={p.name}
              tabIndex={0}
              onClick={() => toggle(p.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(p.id))}
              className="cursor-pointer outline-none transition-colors focus-visible:stroke-[4]"
              fill={on ? "#fca5a5" : "#e6f4f1"}
              stroke={on ? "#dc2626" : "#0f8f7a"}
              strokeWidth={2}
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-2">
        {PARTS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => toggle(p.id)}
            aria-pressed={value.includes(p.id)}
            className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${value.includes(p.id) ? "border-red-300 bg-red-50 text-red-700" : "hover:bg-muted"}`}
          >
            {p.name}
          </button>
        ))}
        <p className="w-full text-sm text-muted-foreground">Өвдөлт, эвгүй мэдрэмжтэй хэсгийг сонгоно уу (заавал биш).</p>
      </div>
    </div>
  );
}
