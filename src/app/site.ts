export const REPO_URL = "https://github.com/dapss/blackout";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_RELEASE__: boolean;

export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
/** True for a tagged release; false for preview builds of main and local builds. */
export const APP_RELEASED = __APP_RELEASE__;
export const COMMIT_URL = APP_COMMIT ? `${REPO_URL}/commit/${APP_COMMIT}` : REPO_URL;
export const LIVE_URL = "https://blackout-redact.pages.dev";
export const VERIFY_URL = `${REPO_URL}#verify-this-copy`;
