import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMaxPrice, parseNetwork } from "./config.js";
import { SERVER_VERSION } from "./server.js";

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"),
  ) as T;
}

describe("parseNetwork", () => {
  it("defaults to mainnet when unset", () => {
    expect(parseNetwork(undefined)).toBe("base");
    expect(parseNetwork("")).toBe("base");
  });

  it("accepts the two supported networks", () => {
    expect(parseNetwork("base")).toBe("base");
    expect(parseNetwork("base-sepolia")).toBe("base-sepolia");
  });

  it("refuses a misspelling rather than falling back to mainnet", () => {
    // The failure this prevents costs real money: someone types
    // "base-sepolio", and a tolerant parser silently pays in live USDC.
    expect(() => parseNetwork("base-sepolio")).toThrow(/TOLLBOOTH_NETWORK/);
    expect(() => parseNetwork("mainnet")).toThrow();
  });
});

describe("parseMaxPrice", () => {
  it("passes through a dollar amount, and undefined when unset", () => {
    expect(parseMaxPrice("$0.02")).toBe("$0.02");
    expect(parseMaxPrice("$1")).toBe("$1");
    expect(parseMaxPrice(undefined)).toBeUndefined();
    expect(parseMaxPrice("")).toBeUndefined();
  });

  it("refuses a malformed cap at startup rather than at the first call", () => {
    // Unvalidated, these reach the spend guard and fail as a payment error on
    // the first paid call — which reads like an empty wallet and sends the
    // operator looking in entirely the wrong place.
    expect(() => parseMaxPrice("0.02")).toThrow(/TOLLBOOTH_MAX_PRICE/);
    expect(() => parseMaxPrice("$0.02 USD")).toThrow();
    expect(() => parseMaxPrice("free")).toThrow();
  });
});

describe("the version is the same in all four places", () => {
  // SERVER_VERSION is hand-copied because the build's rootDir is src/, so the
  // manifest cannot be imported. package.json feeds npm, and server.json
  // carries the version twice for the registry — once for the server and once
  // for the npm package it points at. A bump that misses one publishes a
  // registry entry aimed at a version of the package that does not exist.
  const manifest = readJson<{ version: string; mcpName: string }>(
    "../package.json",
  );
  const server = readJson<{
    name: string;
    version: string;
    packages: { identifier: string; version: string }[];
  }>("../server.json");

  it("agrees across SERVER_VERSION, package.json and both server.json fields", () => {
    expect(SERVER_VERSION).toBe(manifest.version);
    expect(server.version).toBe(manifest.version);
    expect(server.packages[0]?.version).toBe(manifest.version);
  });

  it("keeps server.json pointed at this package under the claimed MCP name", () => {
    // The registry verifies its `name` against the `mcpName` inside the
    // published npm package, so a mismatch fails at publish time.
    expect(server.name).toBe(manifest.mcpName);
    expect(server.packages[0]?.identifier).toBe("agent-tollbooth-mcp");
  });
});
