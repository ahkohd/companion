declare module '*device-appearance.mjs' {
 export const COLOR_TOKENS:string[]
 export const DESIGN_COLOR_TOKENS:Record<string,string>
 export function resolveDesign(design:Record<string,Record<string,number>>,palette:Record<string,number>):Record<import('./lib/studio').ModuleId,Record<string,number>>
}
