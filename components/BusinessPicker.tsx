"use client";

export function BusinessPicker({ contractors, value, onChange }: { contractors: Array<{ id: string; businessName: string; trade: string; active: unknown }>; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {contractors.map((c) => (
        <button key={c.id} onClick={() => onChange(c.id)} className={`btn ${value === c.id ? "" : "btn-ghost"}`}>
          {c.businessName} <span className="opacity-70">({c.trade})</span> {c.active ? "✓" : ""}
        </button>
      ))}
    </div>
  );
}
