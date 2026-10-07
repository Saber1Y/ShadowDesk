import { ArrowRight, Fingerprint, LogIn, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import type { AuthStatus } from "@/lib/types";

const actionClass = "inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_20px_rgba(243,255,151,0.16)] transition-[transform,background-color,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#f7ffb5] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#030206]";

const quietActionClass = "inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground transition-[transform,color,border-color] duration-200 ease-out hover:border-primary/40 hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#030206]";

const identityLabel = (status: AuthStatus): string => status.user?.name || status.user?.preferredUsername || status.user?.email || "Canton identity";

const errorMessage = (error?: string): string => {
  if (error === "expired") return "Your Canton session expired. Connect the wallet again to continue.";
  if (error === "configuration") return "Canton sign-in is not configured yet. Check the server OIDC settings and try again.";
  return "The Canton sign-in did not complete. Start the connection again.";
};

export function WalletAuth({ status, returnTo = "/" }: { status: AuthStatus; returnTo?: string }) {
  if (status.mode !== "devnet") return null;
  if (status.authenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-[150px] truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:block">
          {identityLabel(status)}
        </span>
        {status.source === "environment" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_rgba(243,255,151,0.9)]" />
            Server token
          </span>
        ) : (
          <form action="/api/auth/logout" method="post">
            <button type="submit" className={quietActionClass}>
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        )}
      </div>
    );
  }
  return (
    <a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`} className={actionClass}>
      <LogIn className="size-3.5" />
      <span className="hidden sm:inline">Connect wallet</span>
    </a>
  );
}

export function WalletAuthGate({ status, error, returnTo = "/" }: { status: AuthStatus; error?: string; returnTo?: string }) {
  if (status.mode !== "devnet" || status.authenticated) return null;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card/70 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl md:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Identity gate</p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-[1.05] tracking-[-0.045em] md:text-4xl">
            Connect your Canton identity.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
            ShadowDesk uses the HackCanton wallet to authorize dashboard reads. Your tokens stay on the server, and the browser receives only a protected session reference.
          </p>
          {error && <p role="alert" className="mt-4 max-w-xl border-l-2 border-amber-300/70 pl-3 text-sm leading-6 text-amber-200">{errorMessage(error)}</p>}
          <a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`} className={`${actionClass} mt-6`}>
            <WalletCards className="size-4" />
            Connect Canton wallet
            <ArrowRight className="size-4" />
          </a>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <AuthFeature icon={Fingerprint} title="Code + PKCE" detail="No password is collected by ShadowDesk." />
          <AuthFeature icon={ShieldCheck} title="Server session" detail="Access and refresh tokens never enter browser JavaScript." />
          <AuthFeature icon={WalletCards} title="Scoped identity" detail="The Ledger API permission is checked before access." />
        </div>
      </div>
    </section>
  );
}

function AuthFeature({ icon: Icon, title, detail }: { icon: typeof Fingerprint; title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border/80 bg-[#030206]/45 p-4">
      <Icon className="size-4 text-primary" />
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}
