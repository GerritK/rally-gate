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
