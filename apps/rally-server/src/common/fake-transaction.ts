/**
 * Tests only. Gives a mocked repository the `manager.transaction` that
 * `recordChange` callers use: the callback's manager writes through the
 * mock's own `save`/`delete`, and `inserted` collects the `ChangeRecord`s.
 */
export function withFakeTransaction<R extends object>(repo: R) {
  const writes = repo as {
    save?: (entity: unknown) => unknown;
    delete?: (criteria: unknown) => unknown;
  };
  const inserted: Record<string, unknown>[] = [];
  const manager = {
    save: (_target: unknown, entity: unknown) => writes.save!(entity),
    delete: (_target: unknown, criteria: unknown) => writes.delete!(criteria),
    insert: (_target: unknown, row: Record<string, unknown>) => {
      inserted.push(row);
      return Promise.resolve();
    },
  };
  return Object.assign(repo, {
    manager: {
      transaction: <T>(work: (m: typeof manager) => Promise<T>) =>
        work(manager),
    },
    inserted,
  });
}
