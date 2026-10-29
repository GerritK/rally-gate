import { config } from '../config';
import { BeamOpenStintAdapter } from './beam-openstint.adapter';
import { BeamAdapter } from './beam.adapter';
import { DecoderAdapter } from './decoder-adapter';
import { OpenStintAdapter } from './openstint.adapter';
import { SimulatedAdapter } from './simulated.adapter';

export function createAdapter(): DecoderAdapter {
  switch (config.adapter) {
    case 'simulated':
      return new SimulatedAdapter(config.simulated);
    case 'beam':
      return new BeamAdapter(config.beam);
    case 'openstint':
      return new OpenStintAdapter(config.openstint);
    case 'beam-openstint':
      return new BeamOpenStintAdapter({
        beam: config.beam,
        openstint: config.openstint,
        windowMs: config.pairWindowMs,
        forwardBeamOnly: config.forwardBeamOnly,
      });
  }
}
