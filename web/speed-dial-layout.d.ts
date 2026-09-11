declare module '*speed-dial-layout.mjs' {
  interface SpeedDialLayoutConfig {
    screenShape?: 'round' | 'rectangular'
    layout?: 'grid' | 'list'
    gridSize?: number
    listRows?: number
    showLabels?: boolean
    pageCount?: number
    buttonCount?: number
  }

  export const SPEED_DIAL_MAX_SLOTS: number
  export const SPEED_DIAL_ATLAS_ICON_SIZE: number

  export function speedDialPageSize(
    config: SpeedDialLayoutConfig,
    design?: Record<string, number>,
  ): number

  export function speedDialLayout(
    config: SpeedDialLayoutConfig,
    design?: Record<string, number>,
  ): {
    slots: {
      x: number
      y: number
      width: number
      height: number
      radius: number
      icon: { x: number; y: number; size: number }
      label: {
        x: number
        y: number
        width: number
        height: number
        align: 'left' | 'center'
      } | null
      status: { x: number; y: number; size: number }
    }[]
    page: { x: number; y: number; width: number; height: number }
  }
}
