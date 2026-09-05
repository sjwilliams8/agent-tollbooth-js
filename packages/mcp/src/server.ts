/**
 * The MCP server: two tools over the paid HTTP suite.
 *
 * The tools are NOT themselves paywalled, and that is the whole design. This
 * server runs on the caller's own machine and holds the caller's wallet; it
 * pays our public endpoints through the `agent-tollbooth` SDK. Charging again
 * at the MCP layer would mean two paywalls and two places for money code to
 * live. There is one, at the HTTP edge, and this is a client of it.
 */

import { McpServer } from "@modelcontextprotocol/server";
import type { ComplianceClient } from "agent-tollbooth";
import { z } from "zod";
import { describeToolError } from "./errors.js";
import { formatScreenResult, formatVerifyResult } from "./format.js";

/**
 * Kept in step with package.json by a test rather than by an import: the
 * build has `rootDir: src`, so importing the manifest would push it into the
 * emitted tree.
 */
export const SERVER_VERSION = "0.1.0";
export const SERVER_NAME = "agent-tollbooth-compliance";

/**
 * Every call spends real money, so `idempotentHint` is false even though no
 * state changes: a client that retries freely is buying the same answer
 * twice. `openWorldHint` is true because the answer comes from Treasury and
 * FDIC data that changes daily, not from a fixed table.
 */
const READ_ONLY_PAID = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const screenInput = z.object({
  name: z
    .string()
    .min(1)
    .describe("The counterparty name to screen. Person, company, or vessel."),
  entity_type: z
    .enum(["individual", "entity", "vessel", "aircraft"])
    .optional()
    .describe("Narrows the search when you already know what kind of party this is."),
  country: z
    .string()
    .optional()
    .describe("ISO country name or code. Used to break ties between similar names."),
  min_confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Drop candidates scoring below this (0-100). Defaults to 40. Raise it to cut noise, but note that raising it also hides weak true matches.",
    ),
});

const verifyInput = z.object({
  name: z
    .string()
    .optional()
    .describe("Institution name. Fuzzy and tolerant of word order."),
  cert: z
    .number()
    .int()
    .optional()
    .describe("FDIC certificate number, if you already have it. The exact lookup."),
  domain: z
    .string()
    .optional()
    .describe('Website domain, e.g. "chase.com".'),
  min_confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Drop matches scoring below this (0-100)."),
});

/**
 * Builds the server around an already-configured client. The client is a
 * parameter so tests can drive the real tool handlers against a stubbed
 * transport instead of a wallet and a network.
 */
export function createServer(client: ComplianceClient): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "screen_entity",
    {
      title: "OFAC sanctions screen",
      description:
        "Check whether a person, company, or vessel appears on the U.S. Treasury OFAC sanctions lists (SDN and Consolidated non-SDN). Use before onboarding, paying, or contracting with a counterparty. Returns ranked candidates with a 0-100 confidence, the sanctions programs, and what matched. Costs $0.01 in USDC per call. Results are an assistive screening signal for review, never a compliance determination, and an empty result is not proof the party is unsanctioned.",
      inputSchema: screenInput,
      annotations: READ_ONLY_PAID,
    },
    async (args) => {
      try {
        const result = await client.screenEntity(args);
        return { content: [{ type: "text", text: formatScreenResult(result) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: describeToolError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "verify_fdic_institution",
    {
      title: "FDIC bank verification",
      description:
        "Verify that a U.S. bank exists and is FDIC-insured, using the FDIC's own BankFind records. Look up by name, FDIC certificate number, or website domain. Renamed, merged, and failed institutions stay findable — an inactive result is an answer, not a miss. Costs $0.01 in USDC per call.",
      inputSchema: verifyInput,
      annotations: READ_ONLY_PAID,
    },
    async (args) => {
      try {
        const result = await client.verifyInstitution(args);
        return { content: [{ type: "text", text: formatVerifyResult(result) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: describeToolError(error) }],
          isError: true,
        };
      }
    },
  );

  return server;
}
