import { useState } from "react";

interface Props {
  label: string;
  onClick: () => Promise<void>;
  disabled?: boolean;
  variant?: "primary" | "danger" | "secondary";
}

const VARIANTS = {
  primary:   "bg-indigo-600 hover:bg-indigo-700 text-white",
  danger:    "bg-red-600 hover:bg-red-700 text-white",
  secondary: "bg-slate-200 hover:bg-slate-300 text-slate-800",
};

export function TxButton({ label, onClick, disabled, variant = "primary" }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    setLoading(true);
    setError(null);
    try {
      await onClick();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Extract the Anchor error name from the message when possible.
      const match = msg.match(/Error Code: (\w+)/);
      setError(match ? match[1] : msg.slice(0, 120));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handle}
        disabled={disabled || loading}
        className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]}`}
      >
        {loading ? "Sending…" : label}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
