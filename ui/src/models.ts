import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** One row of the host's model list, as `GET /api/models` answers it. */
export interface ModelInfo {
  name: string
  description?: string
}

const AUTO_ONLY: ModelInfo[] = [{ name: 'auto', description: '' }]

/**
 * The model picker's list. The built-in read the dashboard's shared
 * `useAvailableModels()`; an app page has no such hook and `/api/models` is
 * outside this app's API grant, so the list comes through the app's own
 * `GET /models` route, which answers with the host's list for the same caller.
 * Until it arrives, or when the host cannot list models, only `auto` is
 * offered, and the picker shows just "Default (inherit)".
 */
export function useAvailableModels(): ModelInfo[] {
  const { data } = useQuery<ModelInfo[]>({
    queryKey: ['research-available-models'],
    queryFn: async () => {
      const rows: unknown = await api.researchModels()
      return Array.isArray(rows)
        ? rows.filter((r): r is ModelInfo => !!r && typeof (r as ModelInfo).name === 'string')
        : AUTO_ONLY
    },
    staleTime: 60_000,
    retry: false,
  })
  return data ?? AUTO_ONLY
}
