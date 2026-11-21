/**
 * copyshop's own builds and builds from the source.
 *
 * The source is public (see LICENSE), and anyone may build copyshop for their
 * own use. A build from the source runs fully, with no license key asked for,
 * but it never checks for updates, sends no crash reports or usage counts, and
 * says in Settings that it was built from source, with a link to buy copyshop.
 * Releases, test builds and the website are built with COPYSHOP_OFFICIAL=1.
 */
export const OFFICIAL: boolean = typeof __OFFICIAL__ !== 'undefined' && __OFFICIAL__

/** Where copyshop is bought. */
export const BUY_URL = 'https://getcopyshop.com/buy'
