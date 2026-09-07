import type { BoardProfile } from './studio'

// Existing modules use a 466 px square canvas. Other panel shapes letterbox it.
export function previewDisplay(profile?: BoardProfile | null) {
  const display = profile?.display
  if (!display || !Number.isFinite(display.width) || !Number.isFinite(display.height) || display.width <= 0 || display.height <= 0) {
    return { width:466, height:466, shape:'round' as const }
  }
  return { width:display.width, height:display.height, shape:display.shape === 'round' ? 'round' as const : 'rectangular' as const }
}
