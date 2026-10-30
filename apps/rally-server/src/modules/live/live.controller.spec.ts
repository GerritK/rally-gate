import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessRole, type LiveEventType } from '@rally-gate/shared';
import type { Principal } from '../auth/auth.service';
import { LiveController } from './live.controller';

function received(principal: Principal | null): LiveEventType[] {
  const emitter = new EventEmitter2();
  const types: LiveEventType[] = [];
  const subscription = new LiveController(emitter)
    .stream(principal)
    .subscribe((e) => types.push(e.type as LiveEventType));
  for (const event of [
    'detection.created',
    'stage-run.updated',
    'stage-run.split',
    'gate.heartbeat',
    'detection.pending-changed',
    'detection.awaiting-changed',
    'rally.updated',
  ]) {
    emitter.emit(event, {});
  }
  subscription.unsubscribe();
  return types;
}

describe('LiveController', () => {
  it('sends anonymous visitors runs, splits and the rally only', () => {
    expect(received(null)).toEqual(['stage-run', 'stage-run-split', 'rally']);
  });

  it('sends a login everything', () => {
    const marshal: Principal = {
      role: AccessRole.STAGE_MARSHAL,
      device: null,
      invitation: null,
    };
    expect(received(marshal)).toHaveLength(7);
  });
});
