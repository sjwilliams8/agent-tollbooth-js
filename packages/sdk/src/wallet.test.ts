import { describe, expect, it } from "vitest";
import { resolveAccount, walletFromEnv } from "./wallet.js";
import { PaymentError } from "./errors.js";

const TEST_KEY = `0x${"11".repeat(32)}`;

describe("walletFromEnv", () => {
  it("finds a private key", () => {
    expect(walletFromEnv({ TOLLBOOTH_PRIVATE_KEY: TEST_KEY })).toEqual({
      privateKey: TEST_KEY,
    });
  });

  it("finds CDP credentials only when all three are present", () => {
    expect(
      walletFromEnv({ CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" }),
    ).toBeNull();
    expect(
      walletFromEnv({
        CDP_API_KEY_ID: "id",
        CDP_API_KEY_SECRET: "secret",
        CDP_WALLET_SECRET: "wallet",
      }),
    ).toEqual({
      cdp: { apiKeyId: "id", apiKeySecret: "secret", walletSecret: "wallet" },
    });
  });

  it("prefers an explicit private key over ambient CDP credentials", () => {
    // CDP vars may be set for unrelated reasons on a developer's machine;
    // a key set on purpose is the more specific instruction.
    const config = walletFromEnv({
      TOLLBOOTH_PRIVATE_KEY: TEST_KEY,
      CDP_API_KEY_ID: "id",
      CDP_API_KEY_SECRET: "secret",
      CDP_WALLET_SECRET: "wallet",
    });
    expect(config).toEqual({ privateKey: TEST_KEY });
  });

  it("returns null rather than guessing when nothing is configured", () => {
    expect(walletFromEnv({})).toBeNull();
  });
});

describe("resolveAccount", () => {
  it("derives an address from a private key", async () => {
    const account = await resolveAccount({ privateKey: TEST_KEY });
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("rejects a malformed key loudly instead of at signing time", async () => {
    await expect(resolveAccount({ privateKey: "hunter2" })).rejects.toThrow(
      PaymentError,
    );
    // A key of the right shape but wrong length is the likelier typo.
    await expect(
      resolveAccount({ privateKey: `0x${"11".repeat(31)}` }),
    ).rejects.toThrow(/32-byte hex/);
  });

  it("passes a caller-supplied account straight through", async () => {
    const account = await resolveAccount({ privateKey: TEST_KEY });
    expect(await resolveAccount({ account })).toBe(account);
  });
});
