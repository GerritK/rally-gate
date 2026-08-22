import { SettingsService } from './settings.service';

function makeService(stored?: { value: string }) {
  const settings = {
    findOneBy: jest.fn().mockResolvedValue(stored ?? null),
  };
  return new SettingsService(settings as never);
}

describe('SettingsService.getBoolean', () => {
  it('returns the default when the key was never set', async () => {
    const service = makeService();

    await expect(service.getBoolean('flag', true)).resolves.toBe(true);
    await expect(service.getBoolean('flag', false)).resolves.toBe(false);
  });

  it('parses a stored "false" as false, not just any non-null value as true', async () => {
    const service = makeService({ value: 'false' });

    await expect(service.getBoolean('flag', true)).resolves.toBe(false);
  });

  it('parses a stored "true" as true', async () => {
    const service = makeService({ value: 'true' });

    await expect(service.getBoolean('flag', false)).resolves.toBe(true);
  });
});

describe('SettingsService.getNumber', () => {
  it('returns the default when the key was never set', async () => {
    const service = makeService();

    await expect(service.getNumber('thresholdMs', 1000)).resolves.toBe(1000);
  });

  it('parses a stored number', async () => {
    const service = makeService({ value: '250' });

    await expect(service.getNumber('thresholdMs', 1000)).resolves.toBe(250);
  });

  it('parses a stored zero rather than treating it as unset', async () => {
    const service = makeService({ value: '0' });

    await expect(service.getNumber('thresholdMs', 1000)).resolves.toBe(0);
  });

  it.each(['', 'soon', 'NaN'])(
    'falls back to the default for unparseable %p',
    async (value) => {
      // These reach the DB as free-form strings via PUT /settings/:key, and
      // Number('') is 0 — a silent zero threshold would mean correcting every
      // gate by its network latency.
      const service = makeService({ value });

      await expect(service.getNumber('thresholdMs', 1000)).resolves.toBe(1000);
    },
  );
});
