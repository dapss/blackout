export const AUTHOR_NAME = "Mochamad Daffa";
export const AUTHOR_URL = "https://github.com/dapss";
export const REPO_URL = "https://github.com/dapss/blackout";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

export const APP_VERSION = __APP_VERSION__;
/** Full commit hash this build came from, or "" when unknown. */
export const APP_COMMIT = __APP_COMMIT__;
export const COMMIT_URL = APP_COMMIT ? `${REPO_URL}/commit/${APP_COMMIT}` : REPO_URL;
export const VERIFY_URL = `${REPO_URL}#verify-this-copy`;
