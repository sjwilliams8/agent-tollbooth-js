/**
 * agent-tollbooth — pay-per-call OFAC sanctions screening and FDIC bank
 * verification for AI agents, over the x402 protocol.
 *
 * No account, no API key, no subscription: a funded wallet is the credential.
 */

export {
  ComplianceClient,
  MAINNET_ENDPOINTS,
  TESTNET_ENDPOINTS,
  type ComplianceClientOptions,
  type Endpoints,
  type PaymentNetwork,
} from "./client.js";

export {
  PaymentError,
  RequestError,
  ServiceError,
  TollboothError,
} from "./errors.js";

export {
  resolveAccount,
  walletFromEnv,
  type CdpWalletConfig,
  type WalletConfig,
} from "./wallet.js";

export type {
  FdicInstitution,
  ResponseMeta,
  SanctionsCandidate,
  SanctionsList,
  ScreenEntityInput,
  ScreenEntityResult,
  SourceDataset,
  VerifyInstitutionInput,
  VerifyInstitutionResult,
} from "./types.js";
