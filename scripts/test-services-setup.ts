// Vitest global setup of the integration and security tests: starts the throwaway PostgreSQL and
// S3Mock containers once per run, hands their runtime values to the test files (see
// test-services-env.ts) and removes the containers when the run ends.
import type { TestProject } from 'vitest/node';
import { startTestServices } from './lib/test-services.ts';

export default async function setup(project: TestProject) {
  const services = await startTestServices();
  project.provide('testServices', services.env);
  return () => services.stop();
}
