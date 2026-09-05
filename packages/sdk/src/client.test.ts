import { describe, expect, it } from "vitest";
import { ComplianceClient } from "./client.js";
import { PaymentError, RequestError, ServiceError } from "./errors.js";

/** Valid secp256k1 scalar, never funded. Nothing here reaches a network. */
const TEST_KEY = `0x${"11".repeat(32)}`;

const META = {
  service: "sanctions-screener",
  version: "0.1.0",
  source_datasets: [
    {
      name: "OFAC SDN List",
      upstream_published_at: "2026-09-03T00:00:00-04:00",
      last_synced_at: "2026-09-04T05:02:16.621Z",
    },
  ],
  generated_at: "2026-09-04T12:00:00.000Z",
  disclaimer: "This response is an assistive screening signal...",
};

interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
}

/**
 * A fetch that records what it was called with and replays a canned
 * response. Because it never answers 402, the x402 payment layer stays out
 * of the way — these tests are about the client's own behaviour.
 *
 * It normalises both call shapes on purpose: `wrapFetchWithPayment` rebuilds
 * the call as a `Request` before handing it on, so asserting against
 * `(url, init)` would only ever have tested the unwrapped path.
 */
function recordingFetch(response: { status?: number; body: unknown }): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    if (input instanceof Request) {
      calls.push({
        url: input.url,
        method: input.method,
        body: input.body ? await input.clone().text() : null,
      });
    } else {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body === undefined ? null : String(init.body),
      });
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

function makeClient(response: { status?: number; body: unknown }) {
  const { fetch, calls } = recordingFetch(response);
  const client = new ComplianceClient({
    wallet: { privateKey: TEST_KEY },
    fetch,
  });
  return { client, calls };
}

describe("screenEntity", () => {
  it("posts the query and flattens the envelope", async () => {
    const { client, calls } = makeClient({
      body: {
        data: {
          query: { name: "Banco Nacional de Cuba" },
          candidates: [
            {
              list: "sdn",
              uid: 306,
              match_confidence: 100,
              match_reasons: ["exact_normalized_name"],
              matched_name: "BANCO NACIONAL DE CUBA",
              matched_name_type: "primary",
              name: "BANCO NACIONAL DE CUBA",
              entity_type: "entity",
              programs: ["CUBA"],
              countries: ["Cuba"],
              remarks: null,
            },
          ],
        },
        meta: META,
      },
    });

    const result = await client.screenEntity("Banco Nacional de Cuba");

    const call = calls[0]!;
    expect(call.url).toBe(
      "https://tollbooth-sanctions-screener.sjwilliams8.workers.dev/screen",
    );
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body!)).toEqual({
      name: "Banco Nacional de Cuba",
    });
    // Callers get candidates and meta at the top level, not result.data.*.
    expect(result.candidates[0]?.programs).toEqual(["CUBA"]);
    expect(result.meta.disclaimer).toContain("assistive");
  });

  it("passes the optional filters through", async () => {
    const { client, calls } = makeClient({
      body: { data: { query: {}, candidates: [] }, meta: META },
    });
    await client.screenEntity({
      name: "Acme",
      entity_type: "entity",
      country: "Cuba",
      min_confidence: 80,
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      name: "Acme",
      entity_type: "entity",
      country: "Cuba",
      min_confidence: 80,
    });
  });

  it("returns an empty candidate list rather than throwing on no hit", async () => {
    const { client } = makeClient({
      body: { data: { query: { name: "Nobody" }, candidates: [] }, meta: META },
    });
    const result = await client.screenEntity("Nobody");
    expect(result.candidates).toEqual([]);
  });
});

describe("verifyInstitution", () => {
  it("builds a query string and flattens the envelope", async () => {
    const { client, calls } = makeClient({
      body: {
        data: {
          query: { name: "Bank of America" },
          institutions: [
            {
              cert: 3510,
              name: "Bank of America, National Association",
              active: true,
              insured_status: "active",
              charter_class: "N",
              city: "Charlotte",
              state: "NC",
              domain: null,
              match_confidence: 100,
              match_reasons: ["exact_normalized_name"],
            },
          ],
        },
        meta: { ...META, service: "fdic-verify" },
      },
    });

    const result = await client.verifyInstitution("Bank of America");

    expect(calls[0]!.url).toBe(
      "https://tollbooth-fdic-verify.sjwilliams8.workers.dev/verify?name=Bank+of+America",
    );
    expect(result.institutions[0]?.cert).toBe(3510);
  });

  it("looks up by cert and by domain", async () => {
    const { client, calls } = makeClient({
      body: { data: { query: {}, institutions: [] }, meta: META },
    });
    await client.verifyInstitution({ cert: 3510 });
    await client.verifyInstitution({ domain: "chase.com" });
    expect(calls[0]!.url).toContain("cert=3510");
    expect(calls[1]!.url).toContain("domain=chase.com");
  });

  it("rejects an empty query before spending anything", async () => {
    const { client, calls } = makeClient({ body: {} });
    await expect(client.verifyInstitution({})).rejects.toThrow(RequestError);
    // The point of the guard: no request, so no payment.
    expect(calls).toHaveLength(0);
  });
});

describe("error mapping", () => {
  it("maps a validation failure to RequestError", async () => {
    const { client } = makeClient({
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Body failed validation.",
          details: [{ path: "name", message: "Required" }],
        },
      },
    });
    const error = await client.screenEntity("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).code).toBe("VALIDATION_ERROR");
    expect((error as RequestError).status).toBe(400);
    expect((error as RequestError).details).toEqual([
      { path: "name", message: "Required" },
    ]);
  });

  it("maps a 5xx to ServiceError, which is the retryable one", async () => {
    const { client } = makeClient({
      status: 503,
      body: { error: { code: "DATASET_UNAVAILABLE", message: "No dataset." } },
    });
    const error = await client.screenEntity("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(503);
  });

  it("maps a 402 that outlived the payment layer to PaymentError", async () => {
    // An ordinary 402 is handled invisibly by wrapFetchWithPayment. One that
    // reaches here means payment was made and still refused, which no amount
    // of retrying fixes.
    const { client } = makeClient({
      status: 402,
      body: { error: { code: "PAYMENT_INVALID", message: "Bad payment." } },
    });
    const error = await client.screenEntity("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentError);
  });

  it("refuses a body that is not the documented envelope", async () => {
    const { client } = makeClient({ body: { candidates: [] } });
    const error = await client.screenEntity("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe("MALFORMED_RESPONSE");
  });

  it("says so plainly when a paid route is hit with no wallet", async () => {
    // No wallet is legitimate against an unpaid deployment, so the client
    // sends the request; it is the 402 coming back that identifies the
    // problem, and it should name the fix.
    const { fetch } = recordingFetch({
      status: 402,
      body: { error: { code: "PAYMENT_REQUIRED", message: "Pay up." } },
    });
    const client = new ComplianceClient({ fetch });
    const error = await client.screenEntity("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe("WALLET_MISSING");
    expect((error as PaymentError).message).toContain("privateKey");
  });

  it("works against an unpaid deployment with no wallet at all", async () => {
    const { fetch, calls } = recordingFetch({
      body: { data: { query: {}, candidates: [] }, meta: META },
    });
    const client = new ComplianceClient({
      endpoints: { screener: "http://localhost:8787" },
      fetch,
    });
    const result = await client.screenEntity("x");
    expect(result.candidates).toEqual([]);
    expect(calls[0]!.url).toBe("http://localhost:8787/screen");
  });

  it("calls a transport failure a ServiceError, not a payment problem", async () => {
    // fetch rejects with TypeError for DNS/reset/timeout. Reporting that as
    // PaymentError would tell an agent to stop retrying and top up a wallet
    // that was never the problem.
    const fetchImpl = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    const client = new ComplianceClient({
      wallet: { privateKey: TEST_KEY },
      fetch: fetchImpl,
    });
    const error = await client.screenEntity("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe("NETWORK_ERROR");
  });

  it("turns a non-JSON 200 into a documented error", async () => {
    const fetchImpl = (async () =>
      new Response("<html>captive portal</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof globalThis.fetch;
    const client = new ComplianceClient({
      wallet: { privateKey: TEST_KEY },
      fetch: fetchImpl,
    });
    const error = await client.screenEntity("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe("MALFORMED_RESPONSE");
  });

  it("rejects a blank name before spending anything", async () => {
    const { client, calls } = makeClient({ body: {} });
    await expect(client.screenEntity("   ")).rejects.toThrow(RequestError);
    expect(calls).toHaveLength(0);
  });

  it("recovers after a transient wallet failure instead of latching", async () => {
    // The payment fetch is memoised. Caching a *rejected* promise would kill
    // the client for its whole lifetime over one bad moment.
    let attempts = 0;
    const { fetch } = recordingFetch({
      body: { data: { query: {}, candidates: [] }, meta: META },
    });
    const client = new ComplianceClient({
      fetch,
      wallet: {
        get privateKey(): string {
          attempts += 1;
          if (attempts === 1) throw new Error("transient wallet failure");
          return TEST_KEY;
        },
      },
    });

    await expect(client.screenEntity("x")).rejects.toThrow();
    const result = await client.screenEntity("x");
    expect(result.candidates).toEqual([]);
    // Re-read at all is the signal: a cached rejection would have thrown the
    // second time without ever touching the wallet again. (The exact count is
    // not asserted — resolveAccount reads the key more than once per build.)
    expect(attempts).toBeGreaterThan(1);
  });
});

describe("endpoint selection", () => {
  it("uses the testnet deployments when the network is base-sepolia", async () => {
    const { fetch, calls } = recordingFetch({
      body: { data: { query: {}, candidates: [] }, meta: META },
    });
    const client = new ComplianceClient({
      wallet: { privateKey: TEST_KEY },
      network: "base-sepolia",
      fetch,
    });
    await client.screenEntity("x");
    expect(calls[0]!.url).toContain("screener-testnet");
  });

  it("lets a caller override one endpoint without losing the other", async () => {
    const { fetch, calls } = recordingFetch({
      body: { data: { query: {}, candidates: [] }, meta: META },
    });
    const client = new ComplianceClient({
      wallet: { privateKey: TEST_KEY },
      endpoints: { screener: "http://localhost:8787" },
      fetch,
    });
    await client.screenEntity("x");
    await client.verifyInstitution("y");
    expect(calls[0]!.url).toBe("http://localhost:8787/screen");
    expect(calls[1]!.url).toContain("tollbooth-fdic-verify");
  });
});
