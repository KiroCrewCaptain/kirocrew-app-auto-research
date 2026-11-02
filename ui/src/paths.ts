/** The API prefix the manifest's `permissions.api` grants. */
export const API = '/api/apps/auto-research'

/**
 * The SSE stream of one campaign's events, on this app's own path. The page
 * opens it with the browser's `EventSource` (same origin, the dashboard's
 * session cookie), as the built-in did: the scoped client has no streaming call.
 */
export function campaignStreamUrl(id: string): string {
  return `${API}/campaigns/${encodeURIComponent(id)}/stream`
}
