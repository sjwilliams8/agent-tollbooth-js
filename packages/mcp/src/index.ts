#!/usr/bin/env node
/**
 * stdio entry point. Configuration is environment-only, because that is all
 * an MCP client config can hand a server it launches.
 *
 * Nothing here writes to stdout: on a stdio transport stdout *is* the
 * JSON-RPC channel, and one stray console.log corrupts the stream. Diagnostics
 * go to stderr, which clients surface as server logs.
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { ComplianceClient, walletFromEnv } from "agent-tollbooth";
import { parseMaxPrice, parseNetwork } from "./config.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const network = parseNetwork(process.env["TOLLBOOTH_NETWORK"]);
  const wallet = walletFromEnv();
  const maxPricePerCall = parseMaxPrice(process.env["TOLLBOOTH_MAX_PRICE"]);

  const client = new ComplianceClient({
    wallet: wallet ?? undefined,
    network,
    ...(maxPricePerCall ? { maxPricePerCall } : {}),
  });

  await createServer(client).connect(new StdioServerTransport());

  // Warn, but still start: a client that lists tools before configuring a
  // wallet should see the tools and a useful error, not a dead server.
  if (wallet === null) {
    console.error(
      "agent-tollbooth-mcp: no wallet configured. Set TOLLBOOTH_PRIVATE_KEY to a funded Base wallet; calls will fail until you do.",
    );
  }
  console.error(
    `${SERVER_NAME} ${SERVER_VERSION} on stdio, paying on ${network}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `agent-tollbooth-mcp failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
