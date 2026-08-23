/**
 * SQLite (`SQLITE_CONSTRAINT_UNIQUE`) and Postgres (`23505`) both report a
 * unique violation with a stable machine-readable code, so match on that
 * rather than on the message text.
 *
 * The message is the driver's, not ours: it is wording that varies by driver
 * and version, and matching `/unique/i` against it also claimed any unrelated
 * failure that happened to use the word. A false positive here is quiet and
 * wrong — `startRun` would treat a genuine error as a lost race and return
 * some other row as though nothing had happened.
 *
 * TypeORM wraps driver errors in `QueryFailedError`, which copies the
 * driver's own properties onto itself; `driverError` is checked too so this
 * holds if that ever stops being true.
 */
export function isUniqueViolation(err: unknown): boolean {
  const codes = [
    (err as { code?: unknown })?.code,
    (err as { driverError?: { code?: unknown } })?.driverError?.code,
  ];
  return codes.some(
    (code) => code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505',
  );
}
