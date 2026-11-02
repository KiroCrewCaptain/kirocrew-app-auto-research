// Thin client for the Research Lab backend.
//
// The routes are served by the gateway's route registry under
// /api/apps/auto-research (backend/handlers.py), the prefix `permissions.api`
// grants. Every request goes through the host's permission-scoped client
// (`useAppApi()`), which the page root hands to `setTransport`: a same-origin
// fetch carrying the dashboard's session cookie, refused in the browser for any
// path outside the manifest's grant. A non-2xx surfaces from that client as an
// error carrying the status and the raw body; it is read back here into an
// `ApiError` whose message is the backend's own `error` sentence, as the
// dashboard's client gave the built-in page.

/** The part of the scoped client this module uses. */
export interface Transport {
  raw(path: string, init?: RequestInit): Promise<Response>
}

/** Before the root mounts (tests, or a module evaluated early): a plain fetch. */
const sameOriginFetch: Transport = {
  async raw(path, init) {
    const r = await fetch(path, { credentials: 'same-origin', ...init })
    if (!r.ok) {
      const text = await r.text().catch(() => r.statusText)
      throw Object.assign(new Error(`API ${r.status}: ${text}`), { status: r.status, body: text })
    }
    return r
  },
}

let transport: Transport = sameOriginFetch

/** Route every call through *next* (the page root passes `useAppApi()`). */
export function setTransport(next: Transport | null): void {
  transport = next ?? sameOriginFetch
}

/** A refused call: the HTTP status, the backend's `error` sentence and its raw body. */
export class ApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, message: string, body: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function backendMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const error = (parsed as { error?: unknown }).error
      if (typeof error === 'string' && error) return error
    }
  } catch {
    /* not JSON: the text itself is the reason */
  }
  return body.trim() || `HTTP ${status}`
}

function toApiError(err: unknown): unknown {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    const status = (err as { status: number }).status
    const raw = (err as { body?: unknown }).body
    const body = typeof raw === 'string' ? raw : ''
    return new ApiError(status, backendMessage(status, body), body)
  }
  return err
}

import { API } from './paths'

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  let r: Response
  try {
    r = await transport.raw(API + path, init)
  } catch (err) {
    throw toApiError(err)
  }
  if (r.status === 204) return undefined as T
  const text = await r.text()
  return (text.trim() === '' ? undefined : JSON.parse(text)) as T
}

const get = <T,>(path: string) => call<T>('GET', path)
const post = <T,>(path: string, body?: object) => call<T>('POST', path, body ?? {})
const patch = <T,>(path: string, body: object) => call<T>('PATCH', path, body)
const del = <T,>(path: string) => call<T>('DELETE', path)

/** The built-in's endpoint names (`api.research*` in the dashboard client), unchanged. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export const api = {
  researchValidate: (body: object): Promise<Json> => post('/validate', body),
  researchGrillExpand: (body: object): Promise<Json> => post('/grill/expand', body),
  researchCampaigns: (): Promise<Json> => get('/campaigns'),
  researchCampaign: (id: string): Promise<Json> => get('/campaigns/' + id),
  researchCreate: (body: object): Promise<Json> => post('/campaigns', body),
  researchAction: (id: string, action: string, body?: object): Promise<Json> =>
    patch('/campaigns/' + id, { action, ...body }),
  researchGrillTree: (id: string): Promise<Json> => get('/campaigns/' + id + '/grill-tree'),
  researchNudge: (id: string, text: string): Promise<Json> => post('/campaigns/' + id + '/nudge', { text }),
  researchAddQuestion: (id: string, text: string): Promise<Json> =>
    post('/campaigns/' + id + '/questions', { text }),
  researchToKnowledge: (id: string): Promise<Json> => post('/campaigns/' + id + '/to-knowledge', {}),
  researchKnowledgeStatus: (id: string): Promise<Json> => get('/campaigns/' + id + '/knowledge-status'),
  researchToArtifact: (id: string): Promise<Json> => post('/campaigns/' + id + '/to-artifact', {}),
  researchReportStatus: (id: string): Promise<Json> => get('/campaigns/' + id + '/report-status'),
  researchReport: (id: string): Promise<Json> => get('/campaigns/' + id + '/report'),
  researchDelete: (id: string): Promise<Json> => del('/campaigns/' + id),
  /** The model picker's list, through this app's own route (see backend `_handle_models`). */
  researchModels: (): Promise<Json> => get('/models'),
}
