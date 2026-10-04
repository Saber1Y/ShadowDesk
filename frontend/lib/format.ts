/**
 * Pure display helpers, safe to import from client components.
 *
 * These live apart from `@/lib/canton` because that module pulls in
 * `server-only`: a client component importing it fails the build. Keeping the
 * formatters here means the ledger client stays server-side while the views can
 * still shorten party ids and format amounts.
 */

export const shortCid = (cid: string): string => cid.slice(0, 16);

export const templateSuffix = (templateId: string): string => templateId.split(":").slice(1).join(":");

const NAMESPACE_UUID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-?|[0-9a-fA-F]{8}-)/;

/** `7a030643-dealerA::1220...` reads as `dealerA`; a bare hash has no hint. */
export const partyHint = (party: string): string => {
  const namespace = party.split("::")[0];
  const hinted = namespace.replace(NAMESPACE_UUID, "");
  return hinted.length > 0 ? hinted : namespace.slice(0, 12);
};

export const fmtTime = (iso: string): string => {
  if (!iso) return "-";
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
};

export const fmtAmount = (n: string): string => {
  const v = Number(n);
  if (!isFinite(v)) return n;
  return v.toLocaleString("en-US", { maximumFractionDigits: 10 });
};

export const fmtPrice = (n: string, digits = 2): string => {
  const v = Number(n);
  if (!isFinite(v)) return n;
  return v.toFixed(digits);
};