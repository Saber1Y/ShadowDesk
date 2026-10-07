"use client";

import { motion } from "motion/react";
import { ArrowRight, Check, CircleDot, EyeOff, LockKeyhole, Network, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { ShadowDeskMark } from "@/components/shadowdesk-mark";

const reveal = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
};

export default function LandingPage() {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#030206] px-5 text-foreground md:px-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage: "radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="pointer-events-none absolute -right-48 top-24 size-[34rem] rounded-full bg-primary/[0.06] blur-3xl" />

      <div className="relative z-10 mx-auto max-w-[1280px]">
        <header className="fixed left-1/2 top-5 z-50 flex w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between rounded-full border border-border bg-card/75 px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-xl md:px-5">
          <Link href="/" className="flex items-center gap-3 font-mono text-sm tracking-[0.16em]">
            <span className="flex size-7 items-center justify-center rounded-md border border-border bg-card/80 p-1 shadow-[0_0_15px_rgba(243,255,151,0.15)]">
              <ShadowDeskMark className="size-6" />
            </span>
            <span>SHADOWDESK</span>
          </Link>
          <nav className="hidden items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground lg:flex">
            <a href="#model" className="rounded-full px-4 py-2 transition-colors hover:text-foreground">The model</a>
            <a href="#flow" className="rounded-full px-4 py-2 transition-colors hover:text-foreground">How it works</a>
          </nav>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[0_0_20px_rgba(243,255,151,0.2)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[#f7ffb5] active:scale-[0.98]"
          >
            Open dashboard
            <ArrowRight className="size-3.5" />
          </Link>
        </header>

        <section className="grid min-h-[100dvh] items-center gap-14 pb-16 pt-28 md:grid-cols-[0.9fr_1.1fr] md:gap-16 md:pb-20 md:pt-32">
          <motion.div {...reveal} className="max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Private execution / Canton Network</p>
            <h1 className="mt-5 max-w-[11ch] text-5xl font-semibold leading-[0.96] tracking-[-0.065em] md:text-7xl">
              Treasury execution, <span className="text-primary">bound to the mandate.</span>
            </h1>
            <p className="mt-7 max-w-[38ch] text-base leading-7 text-muted-foreground">
              ShadowDesk turns approved treasury policy into private quotes and atomic settlement.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_0_24px_rgba(243,255,151,0.18)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[#f7ffb5] active:scale-[0.98]"
              >
                Enter the workspace
                <ArrowRight className="size-4" />
              </Link>
              <a href="#model" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                See the model
              </a>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
              <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-primary animate-pulse" /> Live ledger projection</span>
              <span>Two-party approval</span>
              <span>Atomic DvP</span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <LedgerArtifact />
          </motion.div>
        </section>

        <section className="border-y border-border py-5" aria-label="System qualities">
          <div className="grid grid-cols-2 gap-4 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500 md:grid-cols-4">
            <span className="flex items-center gap-2"><LockKeyhole className="size-3 text-primary" /> Stakeholder privacy</span>
            <span className="flex items-center gap-2"><ShieldCheck className="size-3 text-primary" /> Mandate assertions</span>
            <span className="flex items-center gap-2"><Network className="size-3 text-primary" /> Participant views</span>
            <span className="flex items-center gap-2"><Check className="size-3 text-primary" /> DvP receipt</span>
          </div>
        </section>

        <section id="model" className="grid gap-12 py-28 md:grid-cols-[0.72fr_1.28fr] md:gap-20 md:py-36">
          <motion.div {...reveal} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">The privacy model</p>
            <h2 className="mt-4 max-w-md text-4xl font-semibold leading-[1] tracking-[-0.055em] md:text-5xl">
              A public window into a private workflow.
            </h2>
            <p className="mt-6 max-w-md text-[15px] leading-7 text-muted-foreground">
              The public projection exposes metadata. The institutional workspace exposes only the authorized buyer view.
            </p>
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ModelPanel icon={EyeOff} label="Competitor view" title="No rival prices" detail="Each dealer signs its own proposal. A competing dealer cannot query the other quote payload." />
            <ModelPanel icon={ShieldCheck} label="Institutional view" title="Policy before action" detail="The buyer and risk officer approve the envelope before an agent can open the RFQ." />
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-6 sm:col-span-2">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Operator boundary</p>
                  <p className="mt-3 max-w-xl text-lg font-medium tracking-[-0.02em] text-foreground">ShadowDesk coordinates the flow. Canton enforces who can see and settle it.</p>
                </div>
                <Sparkles className="hidden size-5 shrink-0 text-primary sm:block" />
              </div>
            </div>
          </div>
        </section>

        <section id="flow" className="border-t border-border py-28 md:py-36">
          <div className="max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">The execution path</p>
            <h2 className="mt-4 text-4xl font-semibold leading-[1] tracking-[-0.055em] md:text-5xl">From policy to proof.</h2>
          </div>
          <div className="mt-14 grid gap-0 border-y border-border md:grid-cols-3">
            <FlowStep index="01" title="Approve the envelope" detail="Buyer and risk officer define the dealers, instruments, amount, price ceiling, and expiry." />
            <FlowStep index="02" title="Invite private quotes" detail="The agent opens a mandate-bound RFQ. Dealers price independently on their participant views." />
            <FlowStep index="03" title="Settle atomically" detail="The accepted quote becomes binding, then delivery-versus-payment writes one auditable receipt." />
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-border py-28 md:py-36">
          <div className="pointer-events-none absolute right-0 top-1/2 size-72 -translate-y-1/2 rounded-full bg-primary/[0.08] blur-3xl" />
          <div className="relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Live environment</p>
              <h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1] tracking-[-0.055em] md:text-6xl">See the mandate hold the line.</h2>
            </div>
            <Link href="/dashboard" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_0_24px_rgba(243,255,151,0.18)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[#f7ffb5] active:scale-[0.98]">
              Open live dashboard
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>

        <footer className="flex flex-col justify-between gap-3 border-t border-border py-6 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600 sm:flex-row">
            <span>SHADOWDESK · CANTON NETWORK</span>
          <span>PUBLIC VIEW = METADATA ONLY · INSTITUTIONAL VIEW = AUTHORIZED PROJECTION</span>
        </footer>
      </div>
    </main>
  );
}

function LedgerArtifact() {
  return (
    <div className="relative mx-auto max-w-[590px] rotate-[1.5deg] rounded-[1.5rem] border border-border bg-card/65 p-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="rounded-[1.1rem] border border-border/80 bg-[#08090d] p-5 md:p-7">
        <div className="flex items-center justify-between border-b border-border/70 pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><CircleDot className="size-4" /></span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">ShadowDesk / execution console</p>
              <p className="mt-1 text-sm font-medium text-foreground">Mandate-bound treasury round</p>
            </div>
          </div>
          <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-primary"><span className="size-1.5 rounded-full bg-primary animate-pulse" /> Live</span>
        </div>
        <div className="grid gap-3 py-6 sm:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">Approved mandate</p>
            <p className="mt-4 text-2xl font-semibold tracking-[-0.05em] text-foreground">RFQ / 017</p>
            <div className="mt-5 grid grid-cols-2 gap-4 font-mono text-[10px]">
              <div><p className="text-zinc-600">MAX SIZE</p><p className="mt-1 text-foreground">1,000,000</p></div>
              <div><p className="text-zinc-600">CEILING</p><p className="mt-1 text-foreground">101.00</p></div>
            </div>
          </div>
          <div className="space-y-3">
            <SignalRow label="Buyer + risk" value="APPROVED" tone="text-primary" />
            <SignalRow label="Dealer quotes" value="2 PRIVATE" tone="text-lilac" />
            <SignalRow label="Settlement" value="ATOMIC DVP" tone="text-primary" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-[#030206]/60 p-4 font-mono text-[10px] leading-relaxed">
          <div className="flex gap-3"><span className="text-zinc-600">09:41:02</span><span className="text-blue-300">RFQ_CREATED</span><span className="text-zinc-400">private dealer window opened</span></div>
          <div className="mt-2 flex gap-3"><span className="text-zinc-600">09:41:04</span><span className="text-purple-300">QUOTE_SEALED</span><span className="text-zinc-400">winner bound to mandate</span></div>
          <div className="mt-2 flex gap-3"><span className="text-zinc-600">09:41:06</span><span className="text-primary">DVP_SETTLED</span><span className="text-zinc-400">receipt written atomically</span></div>
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-5 -left-5 rounded-xl border border-primary/20 bg-card/80 px-4 py-3 shadow-xl backdrop-blur-xl">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">Participant visibility</p>
        <p className="mt-1 font-mono text-[11px] text-primary">LOSING DEALER / 0 WINNER QUOTES</p>
      </div>
    </div>
  );
}

function SignalRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-border bg-[#030206]/40 px-3 py-3 font-mono text-[9px] uppercase tracking-[0.12em]"><span className="text-zinc-600">{label}</span><span className={tone}>{value}</span></div>;
}

function ModelPanel({ icon: Icon, label, title, detail }: { icon: typeof EyeOff; label: string; title: string; detail: string }) {
  return (
    <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 14 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.5 }} className="rounded-2xl border border-border bg-card/55 p-6 shadow-xl shadow-black/10">
      <Icon className="size-5 text-primary" />
      <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-foreground">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </motion.div>
  );
}

function FlowStep({ index, title, detail }: { index: string; title: string; detail: string }) {
  return (
    <motion.article whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 14 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.5 }} className="border-b border-border p-6 first:border-t md:border-b-0 md:border-r md:p-8 md:first:border-t-0 md:last:border-r-0">
      <p className="font-mono text-[10px] tracking-[0.18em] text-primary">{index}</p>
      <h3 className="mt-12 text-2xl font-semibold tracking-[-0.04em] text-foreground">{title}</h3>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{detail}</p>
    </motion.article>
  );
}
