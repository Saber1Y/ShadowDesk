import assert from "node:assert/strict";
import test from "node:test";
import { projectRealHoldings, projectRealLegs } from "../lib/registry-projection.ts";

test("projects holdings by owner and preserves reserved state", () => {
  const result = projectRealHoldings([
    ["buyer", [
      {
        contractId: "buyer-free-contract-id",
        templateId: "holding-package:Utility.Registry.Holding.V0.Holding:Holding",
        createdAt: "2026-01-01T00:00:00Z",
        createArgument: {
          owner: "buyer-party",
          instrument: { id: "CBTC" },
          amount: "0.0100000000",
        },
      },
      {
        contractId: "buyer-locked-contract-id",
        templateId: "holding-package:Utility.Registry.Holding.V0.Holding:Holding",
        createdAt: "2026-01-01T00:00:01Z",
        createArgument: {
          owner: "dealer-party", // observed by the buyer, owned by the dealer
          instrument: { id: "BETH" },
          amount: "0.0200000000",
          lock: { context: "Allocation Reference;security" },
        },
      },
    ]],
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((row) => [row.role, row.holder, row.instrument, row.locked]), [
    ["buyer", "dealer-party", "BETH", true],
    ["buyer", "buyer-party", "CBTC", false],
  ]);
  assert.equal(result[0].lockContext, "Allocation Reference;security");
});

test("ignores unrelated contracts and projects allocation legs", () => {
  const result = projectRealLegs([
    {
      contractId: "not-an-allocation",
      templateId: "shadowdesk:ShadowDesk.Asset:Asset",
      createdAt: "2026-01-01T00:00:00Z",
      createArgument: {},
    },
    {
      contractId: "allocation-contract-id",
      templateId: "registry:Utility.Registry.V0.Holding.Allocation:DvpLegAllocation",
      createdAt: "2026-01-01T00:00:02Z",
      createArgument: {
        allocation: {
          settlement: { settlementRef: { id: "SHADOWDESK-E2E-1" } },
          transferLegId: "security",
          transferLeg: {
            sender: "dealer-party",
            receiver: "buyer-party",
            amount: "0.0100000000",
            instrumentId: { id: "CBTC" },
          },
        },
      },
    },
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    settlementRef: "SHADOWDESK-E2E-1",
    legId: "security",
    instrument: "CBTC",
    sender: "dealer-party",
    receiver: "buyer-party",
    amount: "0.0100000000",
    cid: "allocation-contr",
    at: "2026-01-01T00:00:02Z",
  });
});
