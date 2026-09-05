/**
 * Turning whatever the caller has into something that can sign a payment.
 *
 * Three ways in, because the two audiences want different things: an outside
 * developer wants one environment variable and no accounts, while a CDP server
 * wallet keeps the key inside Coinbase's TEE and never on disk. Both end up as
 * a viem account, which is all the x402 exact scheme needs (an address and
 * `signTypedData`).
 */

import { privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem";
import { PaymentError } from "./errors.js";

/** Credentials for a Coinbase Developer Platform server wallet. */
export interface CdpWalletConfig {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  /** Server-wallet account name. Created on first use if absent. */
  accountName?: string;
}

export type WalletConfig =
  /** Raw EVM private key. Simplest path; the key is in your process. */
  | { privateKey: string }
  /** A CDP server wallet — the private key stays in Coinbase's TEE. */
  | { cdp: CdpWalletConfig }
  /** Any viem account you have already built. */
  | { account: LocalAccount };

function isHexKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Resolve a wallet config into a signer.
 *
 * The CDP SDK is an optional peer dependency and is imported only on the
 * branch that needs it, so an outside developer paying with a private key
 * never has to install it.
 */
export async function resolveAccount(
  config: WalletConfig,
): Promise<LocalAccount> {
  if ("account" in config) return config.account;

  if ("privateKey" in config) {
    if (!isHexKey(config.privateKey)) {
      throw new PaymentError(
        "privateKey must be a 0x-prefixed 32-byte hex string.",
        "WALLET_INVALID",
      );
    }
    return privateKeyToAccount(config.privateKey);
  }

  const { apiKeyId, apiKeySecret, walletSecret, accountName } = config.cdp;
  let CdpClient: typeof import("@coinbase/cdp-sdk").CdpClient;
  let toAccount: typeof import("viem/accounts").toAccount;
  try {
    ({ CdpClient } = await import("@coinbase/cdp-sdk"));
    ({ toAccount } = await import("viem/accounts"));
  } catch {
    throw new PaymentError(
      "CDP wallets need the optional peer dependency @coinbase/cdp-sdk. " +
        "Install it, or pass a privateKey instead.",
      "WALLET_CDP_UNAVAILABLE",
    );
  }
  const cdp = new CdpClient({ apiKeyId, apiKeySecret, walletSecret });
  const cdpAccount = await cdp.evm.getOrCreateAccount({
    name: accountName ?? "agent-tollbooth",
  });
  return toAccount(cdpAccount) as LocalAccount;
}

/**
 * Build a wallet config from the environment, so a host that only has env vars
 * (an MCP server, a container) needs no wiring code.
 *
 * `TOLLBOOTH_PRIVATE_KEY` wins when both are present — an explicitly set key is
 * a more specific instruction than ambient CDP credentials that may exist for
 * unrelated reasons. Returns null when neither is configured; the caller
 * decides whether that is fatal, because the free routes need no wallet.
 */
export function walletFromEnv(
  env: Record<string, string | undefined> = process.env,
): WalletConfig | null {
  const privateKey = env.TOLLBOOTH_PRIVATE_KEY;
  if (privateKey) return { privateKey };

  const apiKeyId = env.CDP_API_KEY_ID;
  const apiKeySecret = env.CDP_API_KEY_SECRET;
  const walletSecret = env.CDP_WALLET_SECRET;
  if (apiKeyId && apiKeySecret && walletSecret) {
    return {
      cdp: {
        apiKeyId,
        apiKeySecret,
        walletSecret,
        ...(env.CDP_ACCOUNT_NAME ? { accountName: env.CDP_ACCOUNT_NAME } : {}),
      },
    };
  }
  return null;
}
