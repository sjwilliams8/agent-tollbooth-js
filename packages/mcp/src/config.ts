/**
 * Environment parsing, kept out of the entry point so it can be tested
 * without launching a server on stdio.
 */

import type { PaymentNetwork } from "agent-tollbooth";

const NETWORKS: readonly PaymentNetwork[] = ["base", "base-sepolia"];

/**
 * A misspelled network is refused rather than defaulted. Silently falling
 * back to mainnet would spend real USDC for someone who asked for testnet —
 * exactly the kind of guess this project does not make.
 */
export function parseNetwork(value: string | undefined): PaymentNetwork {
  if (value === undefined || value === "") return "base";
  const match = NETWORKS.find((network) => network === value);
  if (match === undefined) {
    throw new Error(
      `TOLLBOOTH_NETWORK must be one of ${NETWORKS.join(", ")} — got "${value}".`,
    );
  }
  return match;
}

/** A dollar amount as the x402 spend guard expects it: "$0.05", "$1". */
const PRICE = /^\$\d+(\.\d{1,6})?$/;

/**
 * Checked at startup for the same reason as the network. This value is a
 * spend guard, and an unparsed one does not fail as "bad setting" — it fails
 * as a payment error on the first real call, which reads like an empty wallet
 * and sends the operator looking in the wrong place entirely.
 */
export function parseMaxPrice(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!PRICE.test(value)) {
    throw new Error(
      `TOLLBOOTH_MAX_PRICE must be a dollar amount like "$0.05" — got "${value}".`,
    );
  }
  return value;
}
