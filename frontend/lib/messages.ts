export type FailureTone = "error" | "warning";

export interface FriendlyFailure {
  title: string;
  message: string;
  action: string;
  tone: FailureTone;
  detail: string;
}

export const describeFailure = (value: unknown, context = "state"): FriendlyFailure => {
  const detail = value instanceof Error ? value.message : String(value ?? "Unknown failure");
  const raw = detail.toLowerCase();

  if (context === "round" && (raw.includes("positive") || raw.includes("instrument") || raw.includes("supported"))) {
    return {
      title: "Check the trade details",
      message: detail,
      action: "Use positive values and choose two different supported instruments.",
      tone: "warning",
      detail,
    };
  }

  if (raw.includes("privacy") || raw.includes("quote secrecy")) {
    return {
      title: "Privacy could not be confirmed",
      message: "The round may have completed, but ShadowDesk could not verify the cross-participant privacy check.",
      action: "Refresh the dashboard and try the round again once both participants are online.",
      tone: "warning",
      detail,
    };
  }

  if (context === "stream" || raw.includes("stream") || raw.includes("snapshot")) {
    return {
      title: "The live update paused",
      message: "The round is no longer reporting progress to the dashboard.",
      action: "Wait a moment while the dashboard reconnects, then refresh if it stays paused.",
      tone: "warning",
      detail,
    };
  }

  if (raw.includes("settle") || raw.includes("receipt") || raw.includes("deal")) {
    return {
      title: "The trade did not settle",
      message: "The delivery-versus-payment step did not finish, so the dashboard cannot confirm the trade.",
      action: "Check the participant connection and run the round again.",
      tone: "error",
      detail,
    };
  }

  if (raw.includes("rejected this identity") || raw.includes("invalid token")) {
    return {
      title: "This identity is not authorized on the ledger",
      message: "You are signed in, but the Canton Ledger API refused this identity.",
      action: "Onboard the account to the HackCanton participant in the Wallet, and confirm its Daml user name matches the signed-in identity.",
      tone: "error",
      detail,
    };
  }

  if (context === "round" || raw.includes("rejected") || raw.includes("maxprice") || raw.includes("proposal")) {
    return {
      title: "The trade request was not completed",
      message: "The venue could not find an eligible dealer quote for this request.",
      action: "Try a higher maximum price, a smaller amount, or run the round again.",
      tone: "warning",
      detail,
    };
  }

  if (
    raw.includes("failed to fetch") ||
    raw.includes("econnrefused") ||
    raw.includes("network") ||
    raw.includes("status 5") ||
    raw.includes("/v2/")
  ) {
    return {
      title: "The trading venue is offline",
      message: "ShadowDesk cannot reach the Canton participants right now.",
      action: "Make sure the local Canton network is running, then wait a moment and try again.",
      tone: "error",
      detail,
    };
  }

  return {
    title: "Something went wrong",
    message: "ShadowDesk could not complete that request.",
    action: "Try again. If the problem continues, share the technical detail with the operator.",
    tone: "error",
    detail,
  };
};
