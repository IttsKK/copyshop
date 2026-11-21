/** Each module's controls, read from its code at build time (scripts/guideControls.ts). */
declare module 'virtual:guide-controls' {
  export interface GuideOption {
    name: string
    text?: string
  }
  export type GuideEntry = { kind: 'group'; text: string } | { kind: 'control'; name: string; text?: string; options?: GuideOption[] }
  const pages: Record<string, GuideEntry[]>
  export default pages
  /** Each module's example picture (public/guide/examples/<id>@<photo>.jpg): which sample photo it is on. */
  export const examples: Record<string, string>
  /** Finished photos where a module is used well (public/guide/showcase/<id>-<n>-original|finished.jpg): their numbers. */
  export const showcase: Record<string, number[]>
}
