import { Env } from './types';

/**
 * Validates that all required environment variables are present
 */
export function validateConfig(env: Env): void {
    const required: (keyof Env)[] = [
        'WEBDAV_URL',
        'WEBDAV_USERNAME',
        'WEBDAV_PASSWORD',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'S3_REGION',
    ];

    const missing = required.filter((key) => !env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

/**
 * Gets the WebDAV base URL, ensuring it ends with a slash
 */
export function getWebDAVBaseUrl(env: Env): string {
    const url = env.WEBDAV_URL;
    return url.endsWith('/') ? url : `${url}/`;
}
