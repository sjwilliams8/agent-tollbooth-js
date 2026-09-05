# agent-tollbooth-mcp

Sanctions screening and bank verification, as MCP tools your agent pays for
itself.

Two tools, no account, no API key. Each call costs **$0.01** in USDC on Base,
paid automatically over the [x402](https://x402.org) protocol.

| Tool | Answers |
| --- | --- |
| `screen_entity` | Is this person, company, or vessel on the OFAC sanctions lists? |
| `verify_fdic_institution` | Is this a real, FDIC-insured US bank? |

## Setup

Add it to your MCP client's config. For Claude Desktop, that is
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-tollbooth": {
      "command": "npx",
      "args": ["-y", "agent-tollbooth-mcp"],
      "env": {
        "TOLLBOOTH_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

`TOLLBOOTH_PRIVATE_KEY` is a Base wallet holding a little USDC. That wallet is
the entire credential — there is nothing to sign up for.

### Try it without spending real money

Point it at Base Sepolia and fund the wallet from a faucet. Same code, same
production datasets, identical answers:

```json
"env": {
  "TOLLBOOTH_PRIVATE_KEY": "0x...",
  "TOLLBOOTH_NETWORK": "base-sepolia"
}
```

### All settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOLLBOOTH_PRIVATE_KEY` | — | Base wallet private key. How calls get paid. |
| `TOLLBOOTH_NETWORK` | `base` | `base` (real USDC) or `base-sepolia` (faucet). A misspelling is refused, not defaulted. |
| `TOLLBOOTH_MAX_PRICE` | `$0.05` | Per-call spend cap, so a mispriced or spoofed payment challenge cannot drain the wallet one call at a time. |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` | — | Use a Coinbase CDP server wallet instead of a raw key; the key stays in Coinbase's TEE. Leave `TOLLBOOTH_PRIVATE_KEY` unset to use these. |
| `CDP_ACCOUNT_NAME` | CDP default | Which named CDP account to pay from. Set this if your funds are in a named account — otherwise payments are signed by the default account and rejected as unfunded, which surfaces as a confusing "payment not accepted" rather than "empty wallet". |

The server starts without a wallet so you can inspect the tools, but calls
will fail with a message telling you exactly what to set.

## Why this one

The data is free and public. What you are buying is that it is **correct, and
kept correct**.

The screener is benchmarked against a 152-case adversarial corpus of
misspellings, word-order swaps, and transliterated aliases: **114 of 114
sanctioned names found, with zero false positives.** On the same corpus a paid
rival returned "MATCH" on 143 of 152 queries, including *Bank of America*. A
screen that flags everything is not a screen.

OFAC data is re-synced from Treasury daily. Every answer states the dataset's
publication date and when we last ingested it, and says `STALE` outright if a
sync failed — you are never guessing how old the answer is.

## What the tools return

Readable text, including the match evidence, the dataset freshness, and the
disclaimer. Two behaviours worth knowing before you wire this into a decision:

- **An empty screen result is not a clearance.** It means nothing scored above
  the confidence threshold. The tool says so in its own output, every time.
- **`active: false` is an answer, not a miss.** Failed, merged, and renamed
  banks stay findable, which is usually the thing you actually needed to know.

## What this is not

An **assistive screening signal** — not a certified compliance determination,
not a consumer report, not legal advice. Name matching is probabilistic: a hit
is a candidate for review, and the absence of a hit is not proof that no
listing exists.

Do not use this for any purpose regulated by the Fair Credit Reporting Act —
no decisions about a person's credit, insurance, employment, or housing.

Full terms:
<https://tollbooth-sanctions-screener.sjwilliams8.workers.dev/terms>

## Related

- [`agent-tollbooth`](https://www.npmjs.com/package/agent-tollbooth) — the same
  two calls as a plain TypeScript SDK, if you are not using MCP. This server is
  a thin layer over it.

## Sources

- U.S. Department of the Treasury, Office of Foreign Assets Control — SDN and
  Consolidated Sanctions Lists
- Federal Deposit Insurance Corporation — BankFind Suite

Both are public U.S. government data. The agencies are authoritative; where our
copy and theirs disagree, theirs is right.

MIT licensed.
