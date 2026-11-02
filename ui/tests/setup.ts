import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetStubSdk } from './stubs/app-sdk'

afterEach(() => {
  cleanup()
  resetStubSdk()
})

// jsdom has no EventSource. The campaign detail view opens one per campaign; a
// test that drives its messages replaces this inert stand-in with its own.
class InertEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  constructor(public url: string) {}
  close(): void {}
}
if (typeof globalThis.EventSource === 'undefined') {
  ;(globalThis as { EventSource?: unknown }).EventSource = InertEventSource
}
