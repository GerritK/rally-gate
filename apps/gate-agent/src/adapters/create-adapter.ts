import { config } from '../config';
import { BeamAdapter } from './beam.adapter';
import { DecoderAdapter } from './decoder-adapter';
import { OpenStintAdapter } from './openstint.adapter';
import { SimulatedAdapter } from './simulated.adapter';

/** Null for an unknown ADAPTER — see main.ts for why that exits. */
export function createAdapter(): DecoderAdapter | null {
  switch (config.adapter) {
    case 'simulated':
      return new SimulatedAdapter(config.simulated);
    case 'beam':
      return new BeamAdapter(config.beam);
    case 'openstint':
      return new OpenStintAdapter(config.openstint);
    default:
      return null;
  }
}
