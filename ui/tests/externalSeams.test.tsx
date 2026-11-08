/**
 * What changed when the page left the dashboard: its own string catalogs, the
 * host's scoped client as the transport (and the backend's own error sentence
 * read back out of its refusal), the model list through the app's own route,
 * the SSE path, the clipboard helper, and the fallbacks for a host older than
 * App Kit level 1.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { CATALOGS, localeChain, t } from '../src/i18n'
import { ApiError, api, setTransport } from '../src/api'
import { campaignStreamUrl } from '../src/paths'
import { copyToClipboard } from '../src/clipboard'
import { useAvailableModels } from '../src/models'
import { renderWithProviders } from './helpers'
import { stubLocale } from './stubs/app-sdk'

const SRC = join(__dirname, '..', 'src')
const I18N = join(__dirname, '..', 'i18n')

function flatten(node: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

describe('the string catalogs', () => {
  it('ships every dashboard locale with the same keys as English', () => {
    const files = readdirSync(I18N).filter(f => f.endsWith('.json')).sort()
    expect(files).toEqual(['bn', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'ru', 'zh-CN'].map(l => `${l}.json`))
    // A plural key carries the forms its locale's rules name (`_one`, `_few`,
    // `_many`, `_other`), so the sets are compared with the form stripped; every
    // plural key keeps an `_other`, the lookup's last resort.
    const PLURAL = /_(zero|one|two|few|many|other)$/
    const keySet = (locale: string) => {
      const keys = flatten(CATALOGS[locale] as Record<string, unknown>)
      for (const stem of new Set(keys.filter(k => PLURAL.test(k)).map(k => k.replace(PLURAL, '')))) {
        expect(keys, `${locale}: ${stem}`).toContain(`${stem}_other`)
      }
      return [...new Set(keys.map(k => k.replace(PLURAL, '')))].sort()
    }
    const english = keySet('en')
    for (const locale of Object.keys(CATALOGS)) {
      expect(keySet(locale), locale).toEqual(english)
    }
  })

  it('has a string for every key the page and the tree name', () => {
    const keys = new Set<string>()
    for (const file of ['ResearchLabPage.tsx', 'GrillTree.tsx']) {
      const text = readFileSync(join(SRC, file), 'utf-8')
      for (const m of text.matchAll(/'(apps\.autoResearch\.[A-Za-z0-9_.]+)'/g)) keys.add(m[1])
    }
    expect(keys.size).toBeGreaterThan(50)
    const missing = [...keys].filter(k => t(k) === k && t(k, { count: 2 }) === k)
    expect(missing).toEqual([])
  })

  it('falls back from a regional locale to its language, then to English', () => {
    expect(localeChain('pt-BR')).toEqual(['pt', 'en'])
    expect(localeChain('zh-CN')).toEqual(['zh-CN', 'en'])
    expect(localeChain('xx')).toEqual(['en'])
    stubLocale('de')
    expect(t('apps.autoResearch.manifest.display_name')).toBe(
      (CATALOGS.de as { apps: { autoResearch: { manifest: { display_name: string } } } }).apps.autoResearch.manifest.display_name,
    )
  })

  it('picks the plural form the locale names', () => {
    expect(t('apps.autoResearch.researchLabPage.findings_count', { count: 3 })).toContain('3')
  })
})

describe('the transport', () => {
  afterEach(() => setTransport(null))

  it('routes every call through the scoped client under the granted prefix', async () => {
    const raw = vi.fn(async () => new Response(JSON.stringify([{ id: 'aaaa1111' }]), { status: 200 }))
    setTransport({ raw })
    await expect(api.researchCampaigns()).resolves.toEqual([{ id: 'aaaa1111' }])
    await api.researchAction('aaaa1111', 'pause')
    await api.researchModels()
    expect(raw.mock.calls.map(c => [c[0], (c[1] as RequestInit).method])).toEqual([
      ['/api/apps/auto-research/campaigns', 'GET'],
      ['/api/apps/auto-research/campaigns/aaaa1111', 'PATCH'],
      ['/api/apps/auto-research/models', 'GET'],
    ])
    expect(JSON.parse(String((raw.mock.calls[1][1] as RequestInit).body))).toEqual({ action: 'pause' })
  })

  it("reads the backend's error sentence and status out of the client's refusal", async () => {
    const body = JSON.stringify({ error: 'Cannot pause a campaign in \'ready\' state' })
    setTransport({ raw: async () => { throw Object.assign(new Error('scoped'), { status: 409, body }) } })
    const err = await api.researchAction('aaaa1111', 'pause').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.message).toBe("Cannot pause a campaign in 'ready' state")
    expect(err.body).toBe(body)
  })

  it('keeps a plain-text refusal as the message', async () => {
    setTransport({ raw: async () => { throw Object.assign(new Error('scoped'), { status: 502, body: 'Bad Gateway' }) } })
    await expect(api.researchCampaigns()).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
  })

  it('passes a refusal that is not the client shape through untouched', async () => {
    const boom = new TypeError('Failed to fetch')
    setTransport({ raw: async () => { throw boom } })
    await expect(api.researchCampaigns()).rejects.toBe(boom)
  })

  it('opens the campaign stream on the app path', () => {
    expect(campaignStreamUrl('aaaa1111')).toBe('/api/apps/auto-research/campaigns/aaaa1111/stream')
  })
})

function ModelNames() {
  const models = useAvailableModels()
  return <div data-testid="models">{models.map(m => m.name).join(',')}</div>
}

describe('the model list', () => {
  afterEach(() => setTransport(null))

  it('comes from the app route', async () => {
    setTransport({ raw: async () => new Response(JSON.stringify([{ name: 'auto' }, { name: 'model-x' }, { bad: 1 }])) })
    renderWithProviders(<ModelNames />)
    await waitFor(() => expect(screen.getByTestId('models')).toHaveTextContent('auto,model-x'))
  })

  it('offers only the default when the route fails', async () => {
    setTransport({ raw: async () => { throw Object.assign(new Error('x'), { status: 500, body: '' }) } })
    renderWithProviders(<ModelNames />)
    await waitFor(() => expect(screen.getByTestId('models')).toHaveTextContent('auto'))
  })
})

describe('the clipboard', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the async API when the page has it', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyToClipboard('# Section')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('# Section')
  })

  it('falls back to execCommand when the async write is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
    const exec = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    await expect(copyToClipboard('text')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })
})

describe('an older host', () => {
  it('uses a native select without the level-1 Select', async () => {
    vi.resetModules()
    vi.doMock('@kirocrew/app-sdk/ui', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./stubs/app-sdk-ui')
      const { Select: _s, guideCaution: _g, ...older } = actual
      return older
    })
    try {
      const hostSdk = await import('../src/hostSdk')
      const NativeSelect = (await import('../src/NativeSelect')).default
      expect(hostSdk.Select).toBe(NativeSelect)
    } finally {
      vi.doUnmock('@kirocrew/app-sdk/ui')
      vi.resetModules()
    }
  })

  it('uses the host Select when it has one', async () => {
    const hostSdk = await import('../src/hostSdk')
    const ui = await import('./stubs/app-sdk-ui')
    expect(hostSdk.Select).toBe(ui.Select)
  })
})
