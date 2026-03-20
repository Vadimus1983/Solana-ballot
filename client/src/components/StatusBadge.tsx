const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  registration: { label: "Registration", classes: "bg-yellow-100 text-yellow-800" },
  voting:       { label: "Voting Open",  classes: "bg-green-100  text-green-800"  },
  closed:       { label: "Closed",       classes: "bg-red-100    text-red-800"    },
  finalized:    { label: "Finalized",    classes: "bg-blue-100   text-blue-800"   },
};

export function StatusBadge({ status }: { status: Record<string, object> }) {
  const key = Object.keys(status)[0] ?? "registration";
  const cfg = STATUS_CONFIG[key] ?? STATUS_CONFIG.registration;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}
