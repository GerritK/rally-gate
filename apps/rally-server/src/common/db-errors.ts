export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /unique/i.test(err.message);
}
