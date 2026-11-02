/**
 * Copy text to the clipboard, restated from the dashboard's `utils/clipboard`
 * (the SDK has no clipboard helper): the async API when the page has it, else
 * the legacy `execCommand('copy')` over a hidden textarea. Resolves to whether
 * the text reached the clipboard.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to the legacy path */
    }
  }
  return execCommandCopy(text)
}

function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
