// Vitest setup file of the integration and security tests: sets the runtime values that point at
// the throwaway services from test-services-setup.ts, before a test file loads the code it tests,
// so the code reads them from process.env as it does in production.
import { inject } from 'vitest';
import type { TestServiceEnv } from './lib/test-services.ts';

const services: TestServiceEnv = inject('testServices');
Object.assign(process.env, services);
