import { motion } from "motion/react";
import { Activity, Lock } from "lucide-react";

export function HudPanel({
  label,
  icon = Activity,
  badge,
  children,
  className = "",
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = icon;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-2xl border border-border bg-card/65 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl md:p-6 ${className}`}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Icon className="size-3.5 text-primary" />
          {label}
        </div>
        {badge ?? (
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-primary">
            <Lock className="size-3" />
            PRIVATE
          </span>
        )}
      </div>
      {children}
    </motion.section>
  );
}

export function StatusPill({
  tone = "muted",
  label,
  pulse = false,
}: {
  tone?: "live" | "ok" | "muted" | "failed";
  label: string;
  pulse?: boolean;
}) {
  const dot =
    tone === "live"
      ? "bg-primary"
      : tone === "ok"
        ? "bg-emerald-400"
        : tone === "failed"
          ? "bg-red-400"
          : "bg-zinc-500";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
      <span className={`size-1.5 rounded-full ${dot} ${pulse ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="border-t border-border pt-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-2.5 text-2xl font-semibold tracking-[-0.04em] ${accent ? "text-primary" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}