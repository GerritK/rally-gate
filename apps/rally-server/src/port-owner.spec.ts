import { parseSsOwner } from './port-owner';

describe('parseSsOwner', () => {
  it('names the process from ss -p output', () => {
    expect(
      parseSsOwner(
        'ESTAB 0 0 192.168.1.5:57431 1.2.3.4:443 users:(("firefox",pid=812,fd=97))',
      ),
    ).toBe('firefox (PID 812)');
  });

  it('is null when ss shows no process (owned by another user, no root)', () => {
    expect(parseSsOwner('ESTAB 0 0 192.168.1.5:57431 1.2.3.4:443')).toBeNull();
  });
});
