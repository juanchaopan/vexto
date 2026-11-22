import { connection } from 'next/server';
import { createHealthResponse, createMethodNotAllowedResponse } from '@/features/health';

// Next.js answers methods without an exported handler with 405 and serves HEAD from GET.
export async function GET(): Promise<Response> {
  // Waiting for an actual request keeps the response from being prerendered at build time.
  await connection();
  return createHealthResponse();
}

// Next.js would answer OPTIONS itself with 204; the health check supports only GET.
export function OPTIONS(): Response {
  return createMethodNotAllowedResponse();
}
