/**
 * What counts as a static asset.
 *
 * This list used to be written out separately in serve.js and in
 * dependencyTracker.js and — fatally — not at all in generate.js, which knew
 * only about *image* extensions. `ursa serve` therefore served fonts, audio and
 * video quite happily while `ursa generate` left them out of the build
 * entirely, so they worked all the way through development and 404'd in
 * production. One list, in one place, used by both.
 */

/** Extensions that get preview generation and image transformation. */
export const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i;

/**
 * Everything else copied through untouched: fonts, documents, audio, video.
 * Deliberately not images, which take a different path, and deliberately not
 * .css, .js, .html or the document formats, all of which are processed rather
 * than copied.
 */
export const MEDIA_EXTENSIONS = /\.(woff2?|ttf|eot|otf|pdf|mp3|m4a|wav|flac|mp4|m4v|webm|ogv|ogg|zip)$/i;

/** Any file the build should place in the output as-is. */
export const STATIC_ASSET_EXTENSIONS = new RegExp(
  `(?:${IMAGE_EXTENSIONS.source})|(?:${MEDIA_EXTENSIONS.source})`,
  'i'
);

export const isImage = (filename) => IMAGE_EXTENSIONS.test(filename);
export const isMedia = (filename) => MEDIA_EXTENSIONS.test(filename);
export const isStaticAsset = (filename) => STATIC_ASSET_EXTENSIONS.test(filename);
