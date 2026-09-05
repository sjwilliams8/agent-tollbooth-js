import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { ComplianceClient } from "agent-tollbooth";
import { describe, expect, it } from "vitest";
import { createServer } from "./server.js";

/** Valid secp256k1 scalar, never funded. Nothing here reaches a network. */
const TEST_KEY = `0x${"11".repeat(32)}`;

const META = {
  service: "sanctions-screener",
  version: "0.1.0",
  source_datasets: [
    {
      name: "OFAC SDN List",
      upstream_published_at: "2026-09-04T00:00:00-04:00",
      last_synced_at: "2026-09-05T01:41:42.000Z",
    },
  ],
  generated_at: "2026-09-05T02:00:00.000Z",
  disclaimer:
    "This response is an assistive screening signal, not a certified compliance determination.",
};

/**
 * Drives the real tool handlers through a real MCP round trip. Testing the
 * formatters alone would never catch a wrong `registerTool` shape or a schema
 * that fails JSON Schema conversion — the two things most likely to break
 * against a client we do not control.
 */
async function connect(response: { status?: number; body: unknown }) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;

  const server = createServer(
    new ComplianceClient({ wallet: { privateKey: TEST_KEY }, fetch: fetchImpl }),
  );
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] })
    .content;
  return content.map((block) => block.text ?? "").join("\n");
}

const CUBA_HIT = {
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
};

describe("tool discovery", () => {
  it("advertises both tools with the names the requirement fixes", async () => {
    const { client } = await connect({ body: CUBA_HIT });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "screen_entity",
      "verify_fdic_institution",
    ]);
  });

  it("marks the tools read-only and priced, so a client does not retry freely", async () => {
    const { client } = await connect({ body: CUBA_HIT });
    const { tools } = await client.listTools();
    const screen = tools.find((tool) => tool.name === "screen_entity");
    expect(screen?.annotations?.readOnlyHint).toBe(true);
    // Each call spends $0.01, so repeats are not free even though no state
    // changes. Advertising idempotency would invite exactly that.
    expect(screen?.annotations?.idempotentHint).toBe(false);
    expect(screen?.description).toContain("$0.01");
  });

  it("publishes an input schema a client can actually read", async () => {
    const { client } = await connect({ body: CUBA_HIT });
    const { tools } = await client.listTools();
    const screen = tools.find((tool) => tool.name === "screen_entity");
    const schema = screen?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toContain("min_confidence");
    expect(schema.required).toEqual(["name"]);
  });
});

describe("screen_entity", () => {
  it("reports a hit with its evidence, freshness and disclaimer", async () => {
    const { client } = await connect({ body: CUBA_HIT });
    const result = await client.callTool({
      name: "screen_entity",
      arguments: { name: "Banco Nacional de Cuba" },
    });
    const text = textOf(result);
    expect(result.isError).toBeFalsy();
    expect(text).toContain("BANCO NACIONAL DE CUBA");
    expect(text).toContain("confidence 100");
    expect(text).toContain("programs: CUBA");
    expect(text).toContain("OFAC SDN List");
    // The terms require the disclaimer wherever the result is surfaced.
    expect(text).toContain("assistive screening signal");
  });

  it("says plainly that an empty result is not a clearance", async () => {
    const { client } = await connect({
      body: { data: { query: { name: "Nobody" }, candidates: [] }, meta: META },
    });
    const text = textOf(
      await client.callTool({
        name: "screen_entity",
        arguments: { name: "Nobody" },
      }),
    );
    expect(text).toContain("No OFAC candidates");
    expect(text).toContain("not a certificate that the party is unsanctioned");
  });

  it("announces a stale dataset instead of quietly serving it", async () => {
    const { client } = await connect({
      body: {
        data: { query: { name: "x" }, candidates: [] },
        meta: {
          ...META,
          source_datasets: [{ ...META.source_datasets[0]!, stale: true }],
        },
      },
    });
    expect(
      textOf(
        await client.callTool({
          name: "screen_entity",
          arguments: { name: "x" },
        }),
      ),
    ).toContain("STALE");
  });

  it("substitutes a disclaimer rather than shipping a result without one", async () => {
    // The terms require the disclaimer wherever a result is surfaced. An
    // absent field used to render as nothing at all — a result with no
    // disclaimer and no error to say so.
    const { disclaimer: _dropped, ...metaWithout } = META;
    const { client } = await connect({
      body: {
        data: { query: { name: "x" }, candidates: [] },
        meta: metaWithout,
      },
    });
    const result = await client.callTool({
      name: "screen_entity",
      arguments: { name: "x" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("assistive screening signal");
  });

  it("still renders a paid answer when the service omits a field", async () => {
    // By this point the $0.01 is spent. Throwing the answer away over a
    // missing list is the most expensive possible reaction to it.
    const { client } = await connect({
      body: {
        data: {
          query: { name: "Partial" },
          candidates: [
            {
              list: "sdn",
              uid: 1,
              match_confidence: 90,
              matched_name: "PARTIAL",
              matched_name_type: "primary",
              name: "PARTIAL",
              entity_type: "entity",
              remarks: null,
            },
          ],
        },
        meta: { ...META, source_datasets: undefined },
      },
    });
    const result = await client.callTool({
      name: "screen_entity",
      arguments: { name: "Partial" },
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain("PARTIAL");
    expect(text).toContain("none reported");
  });

  it("rejects an out-of-range confidence at the schema, before paying", async () => {
    const { client } = await connect({ body: CUBA_HIT });
    const result = await client.callTool({
      name: "screen_entity",
      arguments: { name: "x", min_confidence: 500 },
    });
    expect(result.isError).toBe(true);
  });
});

describe("verify_fdic_institution", () => {
  it("leads with the status, including when a bank is not active", async () => {
    const { client } = await connect({
      body: {
        data: {
          query: { name: "Some Failed Bank" },
          institutions: [
            {
              cert: 1234,
              name: "Some Failed Bank",
              active: false,
              insured_status: "inactive",
              charter_class: "N",
              city: "Reno",
              state: "NV",
              domain: null,
              match_confidence: 92,
              match_reasons: ["exact_normalized_name"],
            },
          ],
        },
        meta: { ...META, service: "fdic-verify" },
      },
    });
    const text = textOf(
      await client.callTool({
        name: "verify_fdic_institution",
        arguments: { name: "Some Failed Bank" },
      }),
    );
    expect(text).toContain("NOT ACTIVE");
    expect(text).toContain("cert 1234");
    // Asserted on both tools, not just the screener: the terms require the
    // disclaimer wherever a result is surfaced, and a mutation that dropped
    // it from the shared formatter was caught by only one of the two.
    expect(text).toContain("assistive screening signal");
  });

  it("looks an institution up by certificate number", async () => {
    const { client } = await connect({
      body: {
        data: { query: { cert: 3510 }, institutions: [] },
        meta: META,
      },
    });
    const text = textOf(
      await client.callTool({
        name: "verify_fdic_institution",
        arguments: { cert: 3510 },
      }),
    );
    expect(text).toContain("cert 3510");
  });
});

describe("failures are reported as answers, not crashes", () => {
  it("tells the caller to fix the arguments on a validation error", async () => {
    const { client } = await connect({
      status: 400,
      body: {
        error: { code: "VALIDATION_ERROR", message: "Body failed validation." },
      },
    });
    const result = await client.callTool({
      name: "screen_entity",
      arguments: { name: "x" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Fix the arguments");
  });

  it("warns not to read a service outage as a clean screen", async () => {
    const { client } = await connect({
      status: 503,
      body: { error: { code: "DATASET_UNAVAILABLE", message: "No dataset." } },
    });
    const result = await client.callTool({
      name: "screen_entity",
      arguments: { name: "x" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("retry");
    // A 5xx cancels settlement, so this failure is free — and an agent that
    // believes it paid may not retry something it should.
    expect(text).toContain("Nothing was charged");
    expect(text).toContain("no screen was performed");
  });

  it("names the env var to set when there is no wallet", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error: { code: "PAYMENT_REQUIRED", message: "Pay up." },
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      )) as typeof globalThis.fetch;
    const server = createServer(new ComplianceClient({ fetch: fetchImpl }));
    const client = new Client({ name: "test", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "screen_entity",
      arguments: { name: "x" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("TOLLBOOTH_PRIVATE_KEY");
  });
});
