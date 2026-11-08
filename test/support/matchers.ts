/**
 * `expect.objectContaining` typed as the value it matches, so it can be nested in an
 * expected object without an `any` value.
 */
export const containing = <T>(value: T): T =>
  expect.objectContaining(value) as T;
