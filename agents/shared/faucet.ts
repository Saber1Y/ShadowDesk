/**
 * BitSafe DevNet CBTC faucet.
 *
 * The faucet is a public HTTP service, not a ledger contract we can call
 * ourselves: it holds the merchant party and mints on our behalf. Without it
 * the two DevNet instruments are unusable, because their issuer admins
 * (`cbtc-network`, `beth-network`) are not parties this project can act as.
 *
 *   POST {api}/networks/{network}/tokens/{token}/transfers
 *        { "recipient_party": "<party>", "amount": "<decimal>" }
 *
 * Limits come from the service rather than being assumed here, because a
 * request outside them is rejected with a 422 and nothing is transferred.
 */

export interface FaucetToken {
  name: string;
  display_name: string;
  instrument_id: { admin: string; id: string };
  min_amount: number;
  max_amount: number;
}

export interface FaucetNetwork {
  name: string;
  display_name: string;
  faucet_party: string;
  tokens: FaucetToken[];
}

export interface FaucetTransferResult {
  message?: string;
  error?: string;
  reason?: string;
  code?: string;
  cause?: string;
  trace_id?: string;
}

/** BitSafe's own decimals are 10; the faucet rejects anything more precise. */
const MAX_DECIMAL_PLACES = 10;

const assertPositiveDecimal = (amount: string, token: string): void => {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`faucet amount for ${token} must be a plain decimal string, got ${JSON.stringify(amount)}`);
  }
  const [, fraction = ""] = amount.split(".");
  if (fraction.length > MAX_DECIMAL_PLACES) {
    throw new Error(
      `faucet amount for ${token} has ${fraction.length} decimal places; the faucet accepts at most ${MAX_DECIMAL_PLACES}`,
    );
  }
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    throw new Error(`faucet amount for ${token} must be greater than zero, got ${amount}`);
  }
};

/** Networks and their tokens, including the per-token amount limits. */
export const fetchFaucetNetworks = async (apiUrl: string): Promise<FaucetNetwork[]> => {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/networks`);
  if (!response.ok) {
    throw new Error(`faucet networks ${apiUrl}/networks failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { networks?: FaucetNetwork[] };
  return body.networks ?? [];
};

export const getFaucetToken = async (
  apiUrl: string,
  network: string,
  token: string,
): Promise<FaucetToken> => {
  const networks = await fetchFaucetNetworks(apiUrl);
  const match = networks.find((n) => n.name === network);
  if (!match) {
    throw new Error(
      `faucet has no network ${network}; it serves ${networks.map((n) => n.name).join(", ") || "none"}`,
    );
  }
  const found = match.tokens.find((t) => t.name === token);
  if (!found) {
    throw new Error(
      `faucet network ${network} has no token ${token}; it serves ${match.tokens.map((t) => t.name).join(", ") || "none"}`,
    );
  }
  return found;
};

/**
 * Ask the faucet to mint `amount` of `token` to `recipientParty`.
 *
 * The limits are checked locally first so an out-of-range amount fails with a
 * useful message instead of an opaque 422, and so a typo cannot turn into a
 * transfer of the wrong size.
 */
export const requestFaucetTransfer = async (request: {
  apiUrl: string;
  network: string;
  token: string;
  recipientParty: string;
  amount: string;
}): Promise<FaucetTransferResult> => {
  const { apiUrl, network, token, recipientParty, amount } = request;
  const spec = await getFaucetToken(apiUrl, network, token);
  assertPositiveDecimal(amount, token);

  const value = Number(amount);
  if (value < spec.min_amount || value > spec.max_amount) {
    throw new Error(
      `faucet ${network}/${token} accepts ${spec.min_amount} to ${spec.max_amount}, got ${amount}`,
    );
  }

  const response = await fetch(
    `${apiUrl.replace(/\/$/, "")}/networks/${network}/tokens/${token}/transfers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_party: recipientParty, amount }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as FaucetTransferResult;
  if (!response.ok) {
    throw new Error(
      `faucet ${network}/${token} transfer to ${recipientParty} failed: HTTP ${response.status} ${body.error ?? body.reason ?? "unknown error"}${body.trace_id ? ` (trace ${body.trace_id})` : ""}`,
    );
  }
  return body;
};