"use client";

import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { motion } from "motion/react";
import type { FriendlyFailure } from "@/lib/messages";

export function FailureNotice({ failure, onRetry }: { failure: FriendlyFailure; onRetry?: () => void }) {
  const Icon = failure.title === "The trading venue is offline" ? WifiOff : AlertTriangle;
  const palette = failure.tone === "error"
    ? { border: "border-red-400/30", background: "bg-red-400/5", icon: "text-red-300", label: "ACTION NEEDED" }
    : { border: "border-amber-300/30", background: "bg-amber-300/5", icon: "text-amber-200", label: "CHECK THIS" };

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mb-6 rounded-2xl border ${palette.border} ${palette.background} px-4 py-4 md:px-5`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-4 shrink-0 ${palette.icon}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className={`font-mono text-[10px] uppercase tracking-[0.18em] ${palette.icon}`}>{palette.label}</p>
            <p className="font-mono text-[12px] font-semibold text-foreground">{failure.title}</p>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{failure.message}</p>
          <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-foreground/80">Next: {failure.action}</p>
          <details className="mt-3">
            <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500 hover:text-foreground">
              Technical detail
            </summary>
            <p className="mt-2 break-words rounded-lg border border-border/60 bg-[#030206]/50 p-3 font-mono text-[10px] leading-relaxed text-zinc-500">
              {failure.detail}
            </p>
          </details>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <RefreshCw className="size-3" /> Retry
          </button>
        )}
      </div>
    </motion.section>
  );
}
