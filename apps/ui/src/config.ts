/**
 * External site URLs opened in the system browser via the Rust `open_external_url`
 * command. Kept in one place so the registration / create-character links are easy
 * to retarget if the portal's routes change.
 */

/** Site root. */
export const SITE_URL = 'https://varryal.ru/'

/** Account registration page — linked from the login screen ("create account"). */
export const REGISTER_URL = 'https://varryal.ru/register'

/** Where to send a player who has no characters yet (create one on the site). */
export const CREATE_CHARACTER_URL = 'https://varryal.ru/'
