/**
 * The client. Two paid calls, one payment path.
 *
 * Everything about x402 is deliberately hidden: a caller supplies a wallet
 * once and then writes ordinary async calls. The 402 handshake, the payment
 * signature and the retry all happen inside `wrapFetchWithPayment`.
 */

import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { PaymentError, RequestError, ServiceError } from "./errors.js";
import { resolveAccount, type WalletConfig } from "./wallet.js";
import type {
  ScreenEntityInput,
  ScreenEntityResult,
  VerifyInstitutionInput,
  VerifyInstitutionResult,
} from "./types.js";

/** Base network the payment settles on. */
export type PaymentNetwork = "base" | "base-sepolia";

/** CAIP-2 chain identifiers, which is what x402 speaks. */
const CAIP2: Record<PaymentNetwork, `eip155:${string}`> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
};

export interface Endpoints {
  screener: string;
  fdic: string;
}

/** Mainnet services. Real USDC, real prices. */
export const MAINNET_ENDPOINTS: Endpoints = {
  screener: "https://tollbooth-sanctions-screener.sjwilliams8.workers.dev",
  fdic: "https://tollbooth-fdic-verify.sjwilliams8.workers.dev",
};

/**
 * Base Sepolia deployments of the same code, reading the same production
 * datasets. Faucet USDC, identical answers — for trying the suite before
 * spending anything real.
 */
export const TESTNET_ENDPOINTS: Endpoints = {
  screener:
    "https://tollbooth-sanctions-screener-testnet.sjwilliams8.workers.dev",
  fdic: "https://tollbooth-fdic-verify-testnet.sjwilliams8.workers.dev",
};

export interface ComplianceClientOptions {
  /** How to pay. Omit only if you are pointing at an unpaid deployment. */
  wallet?: WalletConfig;
  /** Defaults to "base" (mainnet). */
  network?: PaymentNetwork;
  /** Override service URLs. Defaults follow `network`. */
  endpoints?: Partial<Endpoints>;
  /**
   * Refuse to pay more than this for a single call. Defends against a
   * mispriced or spoofed 402 draining a wallet one call at a time — the
   * failure mode that matters when an autonomous agent holds the keys.
   * Defaults to "$0.05"; every route in the suite costs $0.01.
   */
  maxPricePerCall?: string;
  /** Injectable for tests. */
  fetch?: typeof globalThis.fetch;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export class ComplianceClient {
  readonly #options: ComplianceClientOptions;
  readonly #endpoints: Endpoints;
  readonly #baseFetch: typeof globalThis.fetch;
  #paidFetch?: Promise<typeof globalThis.fetch>;

  constructor(options: ComplianceClientOptions = {}) {
    this.#options = options;
    const network = options.network ?? "base";
    const defaults =
      network === "base" ? MAINNET_ENDPOINTS : TESTNET_ENDPOINTS;
    this.#endpoints = { ...defaults, ...options.endpoints };
    this.#baseFetch = options.fetch ?? globalThis.fetch;
  }

  /**
   * Screen a counterparty name against the OFAC SDN and Consolidated lists.
   *
   * Returns ranked candidates, never a bare yes/no: an empty `candidates`
   * array means nothing scored above the threshold, which is not the same
   * claim as "this party is not sanctioned".
   */
  async screenEntity(
    input: ScreenEntityInput | string,
  ): Promise<ScreenEntityResult> {
    const body = typeof input === "string" ? { name: input } : input;
    // Guarded here rather than at the service, which would charge for the
    // 400: payment middleware runs before validation.
    if (body.name === undefined || body.name.trim() === "") {
      throw new RequestError(
        "VALIDATION_ERROR",
        "name is required and cannot be blank.",
        400,
      );
    }
    const payload = await this.#call<{
      query: ScreenEntityInput;
      candidates: ScreenEntityResult["candidates"];
    }>(`${this.#endpoints.screener}/screen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      query: payload.data.query,
      candidates: payload.data.candidates,
      meta: payload.meta,
    };
  }

  /**
   * Verify a US bank against the FDIC's own BankFind records, by name,
   * certificate number, or website domain.
   *
   * Renamed, failed and inactive institutions stay findable — `active: false`
   * is an answer, not a miss.
   */
  async verifyInstitution(
    input: VerifyInstitutionInput | string,
  ): Promise<VerifyInstitutionResult> {
    const query = typeof input === "string" ? { name: input } : input;
    if (
      query.name === undefined &&
      query.cert === undefined &&
      query.domain === undefined
    ) {
      throw new RequestError(
        "VALIDATION_ERROR",
        "One of name, cert, or domain is required.",
        400,
      );
    }
    const params = new URLSearchParams();
    if (query.name !== undefined) params.set("name", query.name);
    if (query.cert !== undefined) params.set("cert", String(query.cert));
    if (query.domain !== undefined) params.set("domain", query.domain);
    if (query.min_confidence !== undefined) {
      params.set("min_confidence", String(query.min_confidence));
    }
    const payload = await this.#call<{
      query: VerifyInstitutionInput;
      institutions: VerifyInstitutionResult["institutions"];
    }>(`${this.#endpoints.fdic}/verify?${params.toString()}`, {
      method: "GET",
    });
    return {
      query: payload.data.query,
      institutions: payload.data.institutions,
      meta: payload.meta,
    };
  }

  /**
   * Built once, on the first call rather than in the constructor, so that
   * constructing a client never reaches for a wallet — and so a wallet
   * config error surfaces at the call that needed it.
   *
   * With no wallet this is the plain fetch, not an error: pointing at an
   * unpaid deployment (a local `wrangler dev`) is a real use, and a paid
   * route then answers 402, which `#call` turns into a clear message.
   */
  #payingFetch(): Promise<typeof globalThis.fetch> {
    this.#paidFetch ??= this.#buildPayingFetch().catch((error: unknown) => {
      // Never cache a rejection. `??=` on a rejected promise would disable
      // the client for its whole lifetime over one transient failure —
      // a CDP timeout, say — with no way back short of a new instance.
      this.#paidFetch = undefined;
      throw error;
    });
    return this.#paidFetch;
  }

  async #buildPayingFetch(): Promise<typeof globalThis.fetch> {
    const wallet = this.#options.wallet;
    if (!wallet) return this.#baseFetch;
    const account = await resolveAccount(wallet);
    const network = CAIP2[this.#options.network ?? "base"];
    return wrapFetchWithPaymentFromConfig(this.#baseFetch, {
      schemes: [{ network, client: new ExactEvmScheme(account) }],
      spendControls: {
        maxAmountPerPayment: this.#options.maxPricePerCall ?? "$0.05",
      },
    });
  }

  async #call<T>(
    url: string,
    init: RequestInit,
  ): Promise<{ data: T; meta: ScreenEntityResult["meta"] }> {
    const fetchWithPayment = await this.#payingFetch();

    let response: Response;
    try {
      response = await fetchWithPayment(url, init);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      // Separating these two matters more than it looks. `fetch` rejects
      // with TypeError only for transport failures — DNS, connection reset,
      // timeout — which are retryable and say nothing about the wallet.
      // Calling those PaymentError would tell an agent to stop retrying and
      // top up a wallet that was never the problem.
      if (cause instanceof TypeError) {
        throw new ServiceError(
          "NETWORK_ERROR",
          `${url} could not be reached: ${detail}`,
        );
      }
      // What is left is the payment layer: an unfundable wallet, a rejected
      // signature, a spend control refusing the price. The call was never
      // made, and retrying as-is will not change that.
      throw new PaymentError(
        `Payment for ${url} could not be completed: ${detail}`,
      );
    }

    if (!response.ok) {
      if (response.status === 402 && !this.#options.wallet) {
        throw new PaymentError(
          `${url} requires payment but no wallet was configured. ` +
            "Pass `wallet: { privateKey }` to the ComplianceClient.",
          "WALLET_MISSING",
        );
      }
      throw await toError(url, response);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // A 200 that is not JSON — a captive portal, a proxy interstitial, a
      // truncated body. Without this the caller gets a raw SyntaxError from
      // outside the four documented error classes.
      throw new ServiceError(
        "MALFORMED_RESPONSE",
        `${url} returned a 2xx body that is not JSON.`,
      );
    }
    return assertEnvelope<T>(payload, url);
  }
}

/** Map a failed response onto the error class that says what to do about it. */
async function toError(url: string, response: Response): Promise<Error> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // A non-JSON error body is itself information; fall through to defaults.
  }
  const code = body.error?.code ?? `HTTP_${response.status}`;
  const message = body.error?.message ?? `${url} returned ${response.status}.`;

  if (response.status === 402) {
    // A 402 that survives the payment layer means payment was attempted and
    // still refused — not the ordinary challenge, which is handled invisibly.
    return new PaymentError(
      `Payment was attempted for ${url} but not accepted: ${message}`,
      code,
    );
  }
  if (response.status >= 500 || response.status === 429) {
    return new ServiceError(code, message, response.status);
  }
  return new RequestError(code, message, response.status, body.error?.details);
}

/**
 * Check the envelope before handing it back.
 *
 * A response that does not have the shape we promise is a broken contract,
 * and returning it anyway would surface as a confusing undefined deep in the
 * caller's code. Better to say so here.
 */
function assertEnvelope<T>(
  payload: unknown,
  url: string,
): { data: T; meta: ScreenEntityResult["meta"] } {
  const envelope = payload as { data?: unknown; meta?: unknown };
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    typeof envelope.data !== "object" ||
    envelope.data === null ||
    typeof envelope.meta !== "object" ||
    envelope.meta === null
  ) {
    throw new ServiceError(
      "MALFORMED_RESPONSE",
      `${url} returned a body that is not a { data, meta } envelope.`,
    );
  }
  return envelope as { data: T; meta: ScreenEntityResult["meta"] };
}
