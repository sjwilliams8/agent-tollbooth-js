# agent-tollbooth-js

The open-source client packages for the **Agent Tollbooth compliance suite** —
OFAC sanctions screening and FDIC bank verification that an AI agent pays for
per call, in USDC on Base, over the [x402](https://x402.org) protocol. No
account, no API key, no subscription.

| Package | What it is |
| --- | --- |
| [`agent-tollbooth`](./packages/sdk) | TypeScript SDK. Two calls, one wallet. |
| [`agent-tollbooth-mcp`](./packages/mcp) | MCP server exposing the same two calls as tools. |

Each package's README is the place to start; both are MIT licensed.

## Why the service itself is not here

What is sold is not the code — the underlying OFAC and FDIC data is free and
public. What is sold is that the data is **correct and kept correct**: the
maintained sync, the freshness guarantees, and a 152-case adversarial test
corpus on which the screener finds **114 of 114** sanctioned names with zero
false positives. The service that does that work is closed; these clients,
which are the part you run and should be able to read, are not.

## Development

```bash
pnpm install
pnpm check     # typecheck, lint, test
```

Note that this repository is generated from a private monorepo, which is where
the services and the contract tests live. Please open an issue rather than a
pull request against mirrored files — a change made only here would be
overwritten on the next sync.
