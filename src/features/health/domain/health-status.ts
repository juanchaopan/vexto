/** Service name the health check reports, so a caller can tell which application answered. */
export const SERVICE_NAME = 'vexto';

export type HealthStatus = {
  status: 'ok';
  service: string;
};

/** Status of the running application: reaching this code means the service is up. */
export function getHealthStatus(): HealthStatus {
  return { status: 'ok', service: SERVICE_NAME };
}
