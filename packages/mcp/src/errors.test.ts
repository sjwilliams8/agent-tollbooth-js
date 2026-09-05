import { PaymentError, RequestError, ServiceError } from "agent-tollbooth";
import { describe, expect, it } from "vitest";
import { describeToolError } from "./errors.js";

/**
 * These assertions are about money, not wording.
 *
 * The x402 middleware cancels settlement whenever the service answers 400 or
 * above, so every 4xx/5xx failure is free and every failure arriving after a
 * settled 200 is not. Telling an agent the wrong one either burns money on
 * pointless retries or stops it retrying something that was free.
 */
describe("what the caller is told it cost", () => {
  it("says nothing was charged on a validation failure", () => {
    const text = describeToolError(
      new RequestError("VALIDATION_ERROR", "Bad name.", 400),
    );
    expect(text).toContain("Nothing was charged");
    expect(text).toContain("Fix the arguments");
  });

  it("says nothing was charged on a 5xx, and to retry", () => {
    const text = describeToolError(
      new ServiceError("DATASET_UNAVAILABLE", "No dataset.", 503),
    );
    expect(text).toContain("Nothing was charged");
    expect(text).toContain("retry");
    expect(text).toContain("no screen was performed");
  });

  it("admits a malformed response WAS paid for, and says not to retry it", () => {
    // This one only happens after a settled 200, and it is deterministic:
    // retrying buys the same broken response again.
    const text = describeToolError(
      new ServiceError("MALFORMED_RESPONSE", "Not an envelope.", 200),
    );
    expect(text).toContain("WAS paid for");
    expect(text).toContain("same broken response");
    expect(text).not.toContain("Nothing was charged");
  });

  it("admits an unrenderable answer WAS paid for, instead of claiming none came", () => {
    // The old copy said "No screening result was produced", which is false:
    // the service answered and the payment settled.
    const text = describeToolError(
      new TypeError("Cannot read properties of undefined (reading 'length')"),
    );
    expect(text).toContain("WAS paid for");
    expect(text).toContain("the answer is lost");
    expect(text).not.toContain("no result was produced");
  });
});

describe("payment failures point at the right fix", () => {
  it("names both wallet routes when none is configured", () => {
    const text = describeToolError(
      new PaymentError("no wallet", "WALLET_MISSING"),
    );
    expect(text).toContain("TOLLBOOTH_PRIVATE_KEY");
    // A CDP user told only about the private key would think they had
    // configured the wrong thing entirely.
    expect(text).toContain("CDP_API_KEY_ID");
    expect(text).toContain("Nothing was charged");
  });

  it("does not tell someone with a malformed key to add funds", () => {
    const text = describeToolError(
      new PaymentError(
        "privateKey must be a 0x-prefixed 32-byte hex string.",
        "WALLET_INVALID",
      ),
    );
    expect(text).toContain("configuration error");
    expect(text).toContain("adding funds will not fix it");
  });

  it("mentions the spend cap, not just an empty wallet, on a generic refusal", () => {
    // The anti-drain guard firing looks exactly like an empty wallet. Saying
    // only "fund it" sends the operator the wrong way.
    const text = describeToolError(
      new PaymentError("Payment could not be completed: over cap"),
    );
    expect(text).toContain("TOLLBOOTH_MAX_PRICE");
    expect(text).toContain("holds less USDC");
  });
});
