import pkg from "../package.json";

/** CLI version, sourced from package.json (the single source of truth). */
export const VERSION: string = pkg.version;
