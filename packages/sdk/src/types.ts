/**
 * Response contracts for the compliance suite.
 *
 * These are hand-written rather than imported from the services, because the
 * services are private and this package is published. That creates a drift
 * hazard — a service could change its response and this package would keep
 * promising the old shape — so each service carries a `sdk-contract.test.ts`
 * that asserts these stay structurally identical to its own types at compile
 * time. A divergence breaks the build, not a customer.
 *
 * The guards live on the service side deliberately: the failure should land
 * on whoever changed the contract, not on whoever next touches this package.
 */

/** Which OFAC list a candidate came from. */
export type SanctionsList = "sdn" | "consolidated";

/** Freshness record for one upstream dataset, carried on every response. */
export interface SourceDataset {
  /** Human-readable dataset name, e.g. "OFAC SDN List". */
  name: string;
  /** Publication date as published by the source agency, ISO 8601. */
  upstream_published_at: string;
  /** When the suite last successfully ingested this dataset, ISO 8601. */
  last_synced_at: string;
  /** Set when a sync failed and the previous dataset is being served. */
  stale?: boolean;
}

/** Envelope metadata present on every response. */
export interface ResponseMeta {
  service: string;
  version: string;
  source_datasets: SourceDataset[];
  generated_at: string;
  /** Assistive-signal disclaimer. Surface it wherever you surface the result. */
  disclaimer: string;
}

export interface ScreenEntityInput {
  /** The counterparty name to screen. Required. */
  name: string;
  entity_type?: "individual" | "entity" | "vessel" | "aircraft";
  /** ISO country name or code, used to break ties between similar names. */
  country?: string;
  /** Drop candidates below this score. Defaults to 40 server-side. */
  min_confidence?: number;
}

export interface SanctionsCandidate {
  list: SanctionsList;
  /** OFAC's own record identifier within that list. */
  uid: number;
  /** 0-100. Not a probability — a ranking score. Review anything above 0. */
  match_confidence: number;
  /** Why this scored as it did, e.g. ["exact_normalized_name"]. */
  match_reasons: string[];
  /** The exact list name (primary or alias) that produced the hit. */
  matched_name: string;
  /** "primary", or the OFAC alias type (aka/fka/nka). */
  matched_name_type: string;
  /** The primary name of the sanctioned party. */
  name: string;
  entity_type: string;
  /** Sanctions programs, e.g. ["CUBA", "SDNTK"]. */
  programs: string[];
  countries: string[];
  remarks: string | null;
}

export interface ScreenEntityResult {
  /** The query as the service parsed it. */
  query: ScreenEntityInput;
  /** Ranked candidates, highest confidence first. Empty means no hit. */
  candidates: SanctionsCandidate[];
  meta: ResponseMeta;
}

export interface VerifyInstitutionInput {
  /** Institution name. Fuzzy and word-order tolerant. */
  name?: string;
  /** FDIC certificate number, if you already have it. */
  cert?: number;
  /** Website domain, e.g. "chase.com". */
  domain?: string;
  min_confidence?: number;
}

export interface FdicInstitution {
  /** FDIC certificate number — the stable identifier for an institution. */
  cert: number;
  name: string;
  /** False for failed, merged, or otherwise inactive institutions. */
  active: boolean;
  insured_status: "active" | "inactive";
  charter_class: string | null;
  city: string | null;
  state: string | null;
  domain: string | null;
  match_confidence: number;
  match_reasons: string[];
}

export interface VerifyInstitutionResult {
  query: VerifyInstitutionInput;
  /** Ranked matches, highest confidence first. Empty means no match. */
  institutions: FdicInstitution[];
  meta: ResponseMeta;
}
