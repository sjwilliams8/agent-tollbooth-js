/**
 * Type-level helper for the SDK drift guards.
 *
 * Bidirectional assignment alone is not enough, which is the trap this
 * exists to close. `const a: Sdk = {} as Service` succeeds when Service has
 * an *extra optional* field — excess-property checking only applies to object
 * literals, not to assignments between named types. Since nearly every field
 * on the input types is optional, an added optional field is the single
 * likeliest way these drift, and it was the one case the first version of
 * the guards silently allowed.
 *
 * So the guards assert two separate things: that the two types are mutually
 * assignable (fields that exist have compatible types), and that their key
 * sets are identical (no field was added or removed on either side).
 *
 * This file is exported from the package only so the guards can import it;
 * it has no runtime behaviour.
 */

/** True only when A and B have exactly the same keys, optional included. */
export type SameKeys<A, B> = [Exclude<keyof A, keyof B>] extends [never]
  ? [Exclude<keyof B, keyof A>] extends [never]
    ? true
    : false
  : false;
