/**
 * The incremental build and dev server as a library, for programs that drive
 * builds themselves (ursa-server): `import { createBuild } from "@kenjura/ursa/build"`.
 * See docs/LIBRARY.md.
 */
export { createBuild } from "../src/helper/build/pass.js";
export { createIgnoreFilter } from "../src/helper/build/watchFilter.js";
export { resolveUrlToOutput } from "../src/helper/build/precedence.js";
export { createDevServer, HOT_RELOAD_PATH } from "../src/devServer.js";
export { getUrsaVersion } from "../src/helper/ursaVersion.js";
