import { shortCid } from "./format.ts";
import type { RealHoldingView, RealLegView } from "./types.ts";

export interface RegistryCreated {
  contractId: string;
  templateId: string;
  createdAt: string;
  createArgument: Record<string, any>;
}

/** Project owned registry holdings, preserving whether each one is reserved. */
export const projectRealHoldings = (byParty: Array<[string, RegistryCreated[]]>): RealHoldingView[] => {
  const out: RealHoldingView[] = [];
  for (const [role, records] of byParty) {
    for (const record of records) {
      if (record.templateId.split(":").pop() !== "Holding") continue;
      const value = record.createArgument;
      const holder = value.owner as string | undefined;
      const instrument = value.instrument?.id as string | undefined;
      if (!holder || !instrument) continue;

      const lock = value.lock;
      const locked = lock !== undefined && lock !== null && (
        Boolean(lock.context) ||
        (Array.isArray(lock.lockers?.map) ? lock.lockers.map.length > 0 : Boolean(lock.lockers))
      );
      out.push({
        holder,
        role,
        instrument,
        amount: String(value.amount ?? "0"),
        locked,
        lockContext: locked ? String(lock.context ?? "reserved") : null,
        cid: shortCid(record.contractId),
      });
    }
  }
  return out.sort((a, b) => a.role.localeCompare(b.role) || a.instrument.localeCompare(b.instrument));
};

/** Project active allocation legs. Consumed legs are captured at settle time. */
export const projectRealLegs = (records: RegistryCreated[]): RealLegView[] => {
  const out: RealLegView[] = [];
  for (const record of records) {
    if (record.templateId.split(":").pop() !== "DvpLegAllocation") continue;
    const allocation = record.createArgument?.allocation;
    const leg = allocation?.transferLeg;
    if (!leg?.instrumentId) continue;
    out.push({
      settlementRef: String(allocation.settlement?.settlementRef?.id ?? ""),
      legId: String(allocation.transferLegId ?? ""),
      instrument: String(leg.instrumentId.id ?? ""),
      sender: String(leg.sender ?? ""),
      receiver: String(leg.receiver ?? ""),
      amount: String(leg.amount ?? "0"),
      cid: shortCid(record.contractId),
      at: record.createdAt,
    });
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
};
