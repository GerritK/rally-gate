import { config } from './config';

const prefix = `[gate-agent:${config.gateId}]`;

export const log = {
  info: (message: string) => console.log(`${prefix} ${message}`),
  warn: (message: string) => console.warn(`${prefix} ${message}`),
  error: (message: string) => console.error(`${prefix} ${message}`),
};
