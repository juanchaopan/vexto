import { describe, expect, it } from 'vitest';
import { getHealthStatus } from './health-status.ts';

describe('getHealthStatus', () => {
  it('reports the service as up under its own name', () => {
    expect(getHealthStatus()).toEqual({ status: 'ok', service: 'vexto' });
  });
});
