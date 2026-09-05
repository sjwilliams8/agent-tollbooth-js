# agent-tollbooth

Sanctions screening and bank verification your AI agent can pay for itself.

No account. No API key. No subscription. Your agent pays **$0.01 per call** in
USDC on Base, using the [x402](https://x402.org) protocol, and gets an answer.

```bash
npm install agent-tollbooth
```

```ts
import { ComplianceClient } from "agent-tollbooth";

const compliance = new ComplianceClient({
  wallet: { privateKey: process.env.TOLLBOOTH_PRIVATE_KEY! },
});

const { candidates } = await compliance.screenEntity("Banco Nacional de Cuba");
// [{ name: "BANCO NACIONAL DE CUBA", match_confidence: 100,
//    programs: ["CUBA"], list: "sdn", matched_name_type: "primary", ... }]

const { institutions } = await compliance.verifyInstitution("Bank of America");
// [{ cert: 3510, active: true, insured_status: "active", state: "NC", ... }]
```

That's the whole surface. Two methods, one wallet, no setup call.

## Why this one

The data is free and public. What you are buying is that it is **correct, and
kept correct** — which is the part that takes a person, not an afternoon.

The screener is benchmarked against a 152-case adversarial corpus of
misspellings, word-order swaps, and transliterated aliases: **114 of 114
sanctioned names found, with zero false positives.** Measured against live
competitors on the same corpus, the free option missed 12 and raised 6 false
positives; a paid rival returned "MATCH" on 143 of 152 queries, including
*Bank of America*. A screen that flags everything is not a screen.

OFAC data is re-synced from Treasury daily; FDIC records daily. Every response
says exactly how fresh it was:

```ts
result.meta.source_datasets;
// [{ name: "OFAC SDN List", upstream_published_at: "2026-09-03T00:00:00-04:00",
//    last_synced_at: "2026-09-04T05:02:16.621Z" }]
```

If a sync fails you get `stale: true` and the previous dataset — never a guess,
and never silence.

## Try it without spending real money

Base Sepolia deployments run the same code against the same production
datasets. Fund a wallet from a faucet and the answers are identical:

```ts
const compliance = new ComplianceClient({
  wallet: { privateKey: process.env.TOLLBOOTH_PRIVATE_KEY! },
  network: "base-sepolia",
});
```

## The two calls

### `screenEntity(name | input)`

```ts
await compliance.screenEntity({
  name: "Vladimir Petrov",
  entity_type: "individual", // individual | entity | vessel | aircraft
  country: "Russia", // breaks ties between similar names
  min_confidence: 60, // default 40
});
```

Screens the OFAC **SDN** and **Consolidated (non-SDN)** lists. Returns ranked
candidates with a 0-100 confidence, the exact list name that matched, and
whether it matched a primary name or an alias.

An empty `candidates` array means nothing scored above your threshold. It is
not a certificate that the party is unsanctioned — see below.

### `verifyInstitution(name | input)`

```ts
await compliance.verifyInstitution({ name: "Chase" });
await compliance.verifyInstitution({ cert: 3510 });
await compliance.verifyInstitution({ domain: "chase.com" });
```

Checks a US bank against the FDIC's own BankFind records. Renamed, merged and
failed institutions stay findable — `active: false` is an answer, not a miss.

## Paying

A wallet is the credential. Three ways to supply one:

```ts
// 1. A private key (simplest).
new ComplianceClient({ wallet: { privateKey: "0x..." } });

// 2. A Coinbase CDP server wallet — the key stays in Coinbase's TEE.
//    Needs the optional peer dep: npm install @coinbase/cdp-sdk
new ComplianceClient({
  wallet: { cdp: { apiKeyId, apiKeySecret, walletSecret } },
});

// 3. Any viem account you already have.
new ComplianceClient({ wallet: { account } });
```

Or read whichever is configured straight from the environment:

```ts
import { ComplianceClient, walletFromEnv } from "agent-tollbooth";

const wallet = walletFromEnv(); // TOLLBOOTH_PRIVATE_KEY, or CDP_* vars
const compliance = new ComplianceClient({ wallet: wallet ?? undefined });
```

With no wallet the client still works against an unpaid deployment — a local
`wrangler dev`, say. Hit a paid route without one and you get a `PaymentError`
that names the fix rather than a silent failure.

**Spend control.** Calls are capped at `$0.05` each by default, so a mispriced
or spoofed payment challenge cannot drain a wallet one call at a time. Every
route in the suite costs $0.01. Raise or lower it deliberately:

```ts
new ComplianceClient({ wallet, maxPricePerCall: "$0.02" });
```

## Errors

Four classes, split by what you should do about them:

| Error | Means | Do |
| --- | --- | --- |
| `RequestError` | Bad input, or no such route | Fix the call; retrying won't help |
| `PaymentError` | Could not pay — no wallet, empty wallet, price over your cap | Fund or reconfigure |
| `ServiceError` | 5xx, rate limit, unreachable host, or a malformed response | Retry with backoff |
| `TollboothError` | Base class of the three above | Catch-all |

```ts
import { PaymentError } from "agent-tollbooth";

try {
  await compliance.screenEntity(name);
} catch (error) {
  if (error instanceof PaymentError) await topUpWallet();
  else throw error;
}
```

`PaymentError` is separate for a reason: it is the only failure an agent can
fix by funding itself, and the only one where blind retrying spends money
without ever succeeding.

## What this is not

Output is an **assistive screening signal**, not a certified compliance
determination, not a consumer report, and not legal advice. Name matching is
probabilistic: a hit is a candidate for review, and the absence of a hit is not
proof that no listing exists.

Do not use this for any purpose regulated by the Fair Credit Reporting Act — no
decisions about a person's credit, insurance, employment, or housing.

Full terms:
<https://tollbooth-sanctions-screener.sjwilliams8.workers.dev/terms>

## Sources

- U.S. Department of the Treasury, Office of Foreign Assets Control — SDN and
  Consolidated Sanctions Lists
- Federal Deposit Insurance Corporation — BankFind Suite

Both are public U.S. government data. The agencies are authoritative; where our
copy and theirs disagree, theirs is right.

MIT licensed.
