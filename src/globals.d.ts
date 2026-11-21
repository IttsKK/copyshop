/** The app's version (src-tauri/tauri.conf.json), set by vite.config.ts. */
declare const __APP_VERSION__: string

/**
 * Whether this is one of copyshop's own builds (COPYSHOP_OFFICIAL=1, set by the release
 * scripts and CI), not one built from the source: see src/platform/build.ts.
 */
declare const __OFFICIAL__: boolean
