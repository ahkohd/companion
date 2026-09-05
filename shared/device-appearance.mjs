export const COLOR_TOKENS = ['background', 'foreground', 'muted', 'surface', 'track', 'accent', 'success', 'warning', 'danger'];
export const DESIGN_COLOR_TOKENS = { textColor: 'foreground', mutedColor: 'muted', cardColor: 'surface', trackColor: 'track', fillColor: 'accent', accentColor: 'accent', lowColor: 'danger', warnColor: 'warning' };
export function resolveDesign(design, palette) {
  return Object.fromEntries(Object.entries(design).map(([module, values]) => [module,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, DESIGN_COLOR_TOKENS[key] ? palette[DESIGN_COLOR_TOKENS[key]] : value]))]));
}
export function resolveDeviceAppearance(settings, system = 'dark') {
  const mode = settings.deviceAppearance.mode;
  const resolved = mode === 'system' ? system : mode;
  const palette = { ...settings.deviceAppearance.palettes[resolved] };
  return { mode, resolved, system, palette, design: resolveDesign(settings.design, palette) };
}
