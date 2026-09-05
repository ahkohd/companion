import defaults from '../../shared/studio-defaults.json'
import type {DevicePalette,DeviceTheme} from './studio'

export const devicePaletteDefaults = defaults.deviceAppearance.palettes as Record<DeviceTheme,DevicePalette>
