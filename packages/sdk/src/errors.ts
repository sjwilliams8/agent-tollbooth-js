/**
 * Errors this package throws.
 *
 * Split by what the caller should DO about it, not by where it happened. An
 * agent that cannot tell "your wallet is empty" from "that name was invalid"
 * will retry the wrong one forever.
 */

/** Base class. Every error this package throws is an instance of this. */
export class TollboothError extends Error {
  /** Stable machine-readable code. Switch on this, not on the message. */
  readonly code: string;
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

/**
 * The request was rejected before it cost anything — bad input, or an
 * endpoint that is not there. Retrying the same call will fail the same way.
 */
export class RequestError extends TollboothError {
  /** Per-field validation detail, when the service supplied it. */
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(code, message, status);
    this.details = details;
  }
}

/**
 * The call could not be paid for. Distinct from every other failure because
 * it is the one an agent can fix by funding its wallet, and the one where
 * blind retrying burns gas without ever succeeding.
 */
export class PaymentError extends TollboothError {
  constructor(message: string, code = "PAYMENT_FAILED") {
    super(code, message);
  }
}

/**
 * The service is up but could not serve — dataset unavailable, upstream
 * failure, rate limit. Worth retrying with backoff.
 */
export class ServiceError extends TollboothError {}
