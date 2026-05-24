/**
 * Caliber brand constants.
 *
 * Centralised so an avatar / asset URL only needs to be changed in one place,
 * not hunted down across opengraph cards, footers, profile pages, etc.
 *
 * Why IPFS, not the OpenSea CDN: the OpenSea CDN (raw2.seadn.io) serves the
 * image as AVIF based on Accept headers, and Vercel's Satori-based OG image
 * renderer doesn't decode AVIF. Pinning the raw PNG on IPFS gives us a stable
 * source format that every renderer handles.
 *
 * If `ipfs.io` becomes flaky, swap to one of:
 *   https://gateway.pinata.cloud/ipfs/QmRQ6SnphN8Bepmve8VSSsdqSuEgFNbSorRhWpD824Rskh
 *   https://cloudflare-ipfs.com/ipfs/QmRQ6SnphN8Bepmve8VSSsdqSuEgFNbSorRhWpD824Rskh
 */
export const POKOBLUE_AVATAR_URL =
  'https://ipfs.io/ipfs/QmRQ6SnphN8Bepmve8VSSsdqSuEgFNbSorRhWpD824Rskh';

/** Canonical site URL for any OG share link, sitemap, or absolute reference. */
export const SITE_URL = 'https://caliber.poko.blue';

/** Canonical rating API base. */
export const API_URL = 'https://caliber-api.poko.blue';

/** Author handle for byline and attribution. */
export const AUTHOR_HANDLE = '@PokoBlue99';
export const AUTHOR_TWITTER_URL = 'https://x.com/PokoBlue99';
