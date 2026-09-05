/**
 * Failures, phrased for a model that has to decide what to do next.
 *
 * MCP tools report failure as an ordinary result with `isError: true` rather
 * than by throwing, so the model sees the message and can act on it. That only
 * helps if the message says which thing happened: fix the arguments, fix the
 * configuration, fund the wallet, or wait and retry.
 *
 * It must also say whether the call was *paid for*, because that is what makes
 * retrying free or expensive. The x402 middleware cancels settlement whenever
 * the service responds 400 or above — verified in `@x402/hono`:
 * `if (res.status >= 400) { cancel(...); return; }`, before `processSettlement`
 * is ever reached. So every 4xx and 5xx failure here costs nothing. The only
 * failures that cost money are the ones that arrive as a settled 200 and then
 * go wrong on our side: `MALFORMED_RESPONSE`, and an unexpected crash while
 * rendering. Those two say so, because for them a retry buys the same failure
 * again.
 */

import { PaymentError, RequestError, ServiceError } from "agent-tollbooth";

/** Where the wallet is read from, named once so messages cannot drift. */
export const PRIVATE_KEY_ENV = "TOLLBOOTH_PRIVATE_KEY";

/**
 * Both supported wallet paths, because a CDP user told only about
 * `TOLLBOOTH_PRIVATE_KEY` would think they had configured the wrong thing.
 */
const WALLET_SETUP_HELP =
  `Set ${PRIVATE_KEY_ENV} to a funded Base wallet private key, or set ` +
  "CDP_API_KEY_ID, CDP_API_KEY_SECRET and CDP_WALLET_SECRET to use a " +
  "Coinbase CDP wallet (plus CDP_ACCOUNT_NAME if the funds are in a named " +
  "account). Then restart the server.";

/** Said wherever a screen did not happen, so absence is never read as a pass. */
const NOT_A_RESULT =
  "Do not treat this as a clean screening result — no screen was performed.";

function describePayment(error: PaymentError): string {
  // These three are raised while resolving the wallet, before any request is
  // made. Nothing was charged and nothing can be, until config changes.
  if (error.code === "WALLET_MISSING") {
    return [
      "No wallet is configured, so this call could not be paid for. Nothing was charged.",
      WALLET_SETUP_HELP,
      "Do not retry until that is done — the call cannot succeed.",
    ].join(" ");
  }
  if (error.code === "WALLET_INVALID" || error.code === "WALLET_CDP_UNAVAILABLE") {
    return [
      `The wallet configuration is unusable (${error.code}): ${error.message}`,
      "This is a configuration error, not an empty wallet — adding funds will not fix it.",
      WALLET_SETUP_HELP,
    ].join(" ");
  }
  return [
    `Payment could not be completed (${error.code}): ${error.message}`,
    "Nothing was charged.",
    // Naming the spend cap matters: the anti-drain guard firing looks exactly
    // like an empty wallet, and telling someone to add funds when their own
    // cap refused the price sends them the wrong way entirely.
    "Two common causes: the wallet holds less USDC than the $0.01 price, or the price exceeded the per-call cap (TOLLBOOTH_MAX_PRICE, default $0.05) and the spend guard refused it.",
    "Check the balance and the cap before retrying.",
  ].join(" ");
}

function describeService(error: ServiceError): string {
  if (error.code === "MALFORMED_RESPONSE") {
    return [
      `The service returned a response that does not match its documented shape: ${error.message}`,
      "This call WAS paid for — settlement completes before the body is read — and the fault is deterministic, so retrying will buy the same broken response again.",
      "Report it rather than retrying.",
      NOT_A_RESULT,
    ].join(" ");
  }
  return [
    `Service error (${error.code}): ${error.message}`,
    "Nothing was charged.",
    "This is a transient failure — wait and retry with backoff.",
    NOT_A_RESULT,
  ].join(" ");
}

export function describeToolError(error: unknown): string {
  if (error instanceof PaymentError) return describePayment(error);

  if (error instanceof RequestError) {
    return [
      `Invalid request (${error.code}): ${error.message}`,
      "Nothing was charged — the service rejected the call before settlement.",
      "Fix the arguments and call again; retrying unchanged will fail the same way.",
    ].join(" ");
  }

  if (error instanceof ServiceError) return describeService(error);

  const message = error instanceof Error ? error.message : String(error);
  return [
    `The answer could not be rendered: ${message}`,
    // The honest and expensive case. Claiming "no result was produced" here
    // would be false: the service answered and the payment settled.
    "The service answered and this call WAS paid for, but the response could not be turned into text, so the answer is lost.",
    "This is a bug in the tool rather than something to retry — a retry spends again for the same outcome.",
    NOT_A_RESULT,
  ].join(" ");
}
