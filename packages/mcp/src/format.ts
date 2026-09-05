/**
 * Turning service responses into the text a model reads.
 *
 * Everything here is pure, so the interesting behaviour — how a no-hit screen
 * is worded, whether a stale dataset is announced, whether the disclaimer
 * survives — is testable without a network or a wallet.
 *
 * Text is the only output. There is deliberately no `outputSchema` /
 * `structuredContent`: every MCP client renders text, and declaring an output
 * schema would put OFAC field names in a third place (service, SDK, here)
 * that could drift apart silently.
 */

import type {
  FdicInstitution,
  ResponseMeta,
  SanctionsCandidate,
  ScreenEntityResult,
  VerifyInstitutionResult,
} from "agent-tollbooth";

/**
 * Used only when a response arrives without a disclaimer of its own. The
 * published terms require the disclaimer wherever a result is surfaced, and
 * an absent field would otherwise render as nothing at all — a result shipped
 * with no disclaimer and no error to say so.
 */
export const FALLBACK_DISCLAIMER =
  "This response is an assistive screening signal derived from public government data. It is not a certified compliance determination, a consumer report, or legal advice.";

function disclaimerOf(meta: ResponseMeta): string {
  const own = typeof meta.disclaimer === "string" ? meta.disclaimer.trim() : "";
  return own === "" ? FALLBACK_DISCLAIMER : own;
}

/**
 * A response reaching the formatter has already been paid for, so a field the
 * service omitted must not throw the answer away. Rendering what did arrive
 * is not guessing: a missing list shows up as absent in the output, which is
 * visible rather than silent.
 */
function asArray<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Freshness, in the words of the response itself. `stale` is called out
 * first and loudly: it means a sync failed and the previous dataset is being
 * served, which changes what the answer is worth.
 */
export function formatDatasets(meta: ResponseMeta): string {
  const datasets = asArray(meta.source_datasets);
  if (datasets.length === 0) return "Data sources: none reported.";
  const lines = datasets.map((dataset) => {
    const stale = dataset.stale ? " [STALE — last sync failed]" : "";
    return `  - ${dataset.name}: published ${dataset.upstream_published_at}, synced ${dataset.last_synced_at}${stale}`;
  });
  return `Data sources:\n${lines.join("\n")}`;
}

function formatCandidate(candidate: SanctionsCandidate, index: number): string {
  const facts = [
    `list: ${candidate.list} (uid ${candidate.uid})`,
    candidate.entity_type,
    asArray(candidate.programs).length > 0
      ? `programs: ${asArray(candidate.programs).join(", ")}`
      : undefined,
    asArray(candidate.countries).length > 0
      ? `countries: ${asArray(candidate.countries).join(", ")}`
      : undefined,
  ].filter((part): part is string => part !== undefined);

  const lines = [
    `${index + 1}. ${candidate.name} — confidence ${candidate.match_confidence}`,
    `   ${facts.join(" | ")}`,
    `   matched "${candidate.matched_name}" (${candidate.matched_name_type}) via ${asArray(candidate.match_reasons).join(", ")}`,
  ];
  if (candidate.remarks) lines.push(`   remarks: ${candidate.remarks}`);
  return lines.join("\n");
}

export function formatScreenResult(result: ScreenEntityResult): string {
  const name = result.query.name;
  const candidates = asArray(result.candidates);
  const sections: string[] = [];

  if (candidates.length === 0) {
    sections.push(
      `No OFAC candidates for "${name}".`,
      // The single most likely way a model misuses this tool is treating an
      // empty list as a clearance. Saying so is part of the answer, not a
      // footnote.
      "An empty result means nothing in the OFAC SDN or Consolidated lists scored above the confidence threshold. It is not a certificate that the party is unsanctioned.",
    );
  } else {
    const top = candidates[0]?.match_confidence ?? 0;
    const plural = candidates.length === 1 ? "candidate" : "candidates";
    sections.push(
      `${candidates.length} OFAC ${plural} for "${name}" (highest confidence ${top}). Each is a candidate for review, not a determination.`,
      candidates.map(formatCandidate).join("\n\n"),
    );
  }

  sections.push(formatDatasets(result.meta), disclaimerOf(result.meta));
  return sections.join("\n\n");
}

function formatInstitution(
  institution: FdicInstitution,
  index: number,
): string {
  const where = [institution.city, institution.state]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const facts = [
    `cert ${institution.cert}`,
    // "active: false" is a real answer — a failed or merged bank is still a
    // fact about that name — so the status leads rather than hides.
    institution.active
      ? "ACTIVE, FDIC-insured"
      : `NOT ACTIVE (insured_status: ${institution.insured_status})`,
    institution.charter_class
      ? `charter class ${institution.charter_class}`
      : undefined,
    where || undefined,
    institution.domain ?? undefined,
  ].filter((part): part is string => part !== undefined);

  return [
    `${index + 1}. ${institution.name} — confidence ${institution.match_confidence}`,
    `   ${facts.join(" | ")}`,
    `   matched via ${asArray(institution.match_reasons).join(", ")}`,
  ].join("\n");
}

export function formatVerifyResult(result: VerifyInstitutionResult): string {
  const asked =
    result.query.name ??
    (result.query.cert !== undefined
      ? `cert ${result.query.cert}`
      : (result.query.domain ?? "the query"));
  const institutions = asArray(result.institutions);
  const sections: string[] = [];

  if (institutions.length === 0) {
    sections.push(
      `No FDIC-insured institution matched ${asked}.`,
      "No match means the FDIC's BankFind records contain no institution scoring above the threshold — including institutions that never existed under that name. It does not by itself prove an entity is not a bank.",
    );
  } else {
    const plural = institutions.length === 1 ? "institution" : "institutions";
    sections.push(
      `${institutions.length} FDIC ${plural} matched ${asked}.`,
      institutions.map(formatInstitution).join("\n\n"),
    );
  }

  sections.push(formatDatasets(result.meta), disclaimerOf(result.meta));
  return sections.join("\n\n");
}
