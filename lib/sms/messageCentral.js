'use strict';

/**
 * messageCentral.js
 * ------------------
 * Production-ready wrapper around the Message Central CPaaS API v2.
 *
 * Capabilities:
 *  - Lazy auth-token caching with proactive refresh before expiry
 *  - sendOtp(phone, otpLength)  → verificationId
 *  - verifyOtp(phone, verificationId, code) → { success, responseCode, message }
 *
 * Environment variables required:
 *  MESSAGE_CENTRAL_CUSTOMER_ID  — your Customer ID
 *  MESSAGE_CENTRAL_AUTH_TOKEN   — long-lived Bearer token from dashboard
 *
 * API Base: https://cpaas.messagecentral.com
 */

const https = require('https');
const logger = require('@util/logger');

// ─── Constants ──────────────────────────────────────────────────────────────

const BASE_URL    = 'https://cpaas.messagecentral.com';
const COUNTRY     = '91';   // India — adjust if multi-country support is needed
const OTP_DEFAULT_LENGTH = 6;
const REQUEST_TIMEOUT_MS = 15_000;

// ─── Internal state ──────────────────────────────────────────────────────────

/** Cached auth token + its expiry timestamp (ms). */
const _cache = {
  token: null,
  expiresAt: 0,          // UNIX ms
};

// ─── HTTP helper ────────────────────────────────────────────────────────────

/**
 * Minimal promisified HTTPS request helper.
 * Returns parsed JSON body on success, throws on non-2xx or network error.
 *
 * @param {'GET'|'POST'} method
 * @param {string}       urlString   Full absolute URL (with query params if any)
 * @param {object}       [headers]   Additional request headers
 * @param {string|null}  [body]      Request body (for POST)
 * @returns {Promise<any>}
 */
function _request(method, urlString, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlString);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Accept': 'application/json',
        ...headers,
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    if (body) {
      options.headers['Content-Type']   = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(
              new Error(
                `[MessageCentral] HTTP ${res.statusCode}: ${
                  parsed?.message || parsed?.error || raw
                }`
              )
            );
          }
        } catch {
          // Non-JSON response
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(raw);
          } else {
            reject(new Error(`[MessageCentral] HTTP ${res.statusCode}: ${raw}`));
          }
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('[MessageCentral] Request timed out'));
    });

    req.on('error', (err) => reject(err));

    if (body) req.write(body);
    req.end();
  });
}

// ─── Auth token management ────────────────────────────────────────────────────

/**
 * Returns a valid Message Central auth token.
 * Uses the long-lived token from env by default.
 * If that token is within 24h of expiry (or we need a fresh one via API),
 * this function can be extended to call the token-generation endpoint.
 *
 * For now: the token in env is valid until ~2039, so we use it directly
 * and cache it for the process lifetime.
 *
 * @returns {Promise<string>}
 */
async function getAuthToken() {
  const now = Date.now();

  // Return cached token if still valid (refresh 5 min before expiry)
  if (_cache.token && _cache.expiresAt - now > 5 * 60 * 1000) {
    return _cache.token;
  }

  const envToken = process.env.MESSAGE_CENTRAL_AUTH_TOKEN;
  if (!envToken) {
    throw new Error(
      '[MessageCentral] MESSAGE_CENTRAL_AUTH_TOKEN is not set in environment'
    );
  }

  // Parse expiry from JWT payload (base64 segment)
  try {
    const payloadB64  = envToken.split('.')[1];
    const payload     = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    const expiresAtMs = payload.exp ? payload.exp * 1000 : Date.now() + 365 * 24 * 3600 * 1000;

    _cache.token     = envToken;
    _cache.expiresAt = expiresAtMs;
    logger.debug(
      `[MessageCentral] Auth token loaded (expires: ${new Date(expiresAtMs).toISOString()})`
    );
  } catch {
    // If we can't parse expiry, cache for 24 hours
    _cache.token     = envToken;
    _cache.expiresAt = Date.now() + 24 * 3600 * 1000;
  }

  return _cache.token;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send an OTP to the given mobile number.
 *
 * @param {string} phone         E.164 formatted phone number e.g. '+919876543210'
 * @param {number} [otpLength=6] Digit length of the OTP (4 or 6)
 * @returns {Promise<string>}    verificationId — required for validateOtp
 * @throws {Error}               On API failure or missing credentials
 */
async function sendOtp(phone, otpLength = OTP_DEFAULT_LENGTH) {
  const customerId = process.env.MESSAGE_CENTRAL_CUSTOMER_ID;
  if (!customerId) {
    throw new Error(
      '[MessageCentral] MESSAGE_CENTRAL_CUSTOMER_ID is not set in environment'
    );
  }

  // Strip country code prefix to get the bare mobile number
  const mobileNumber = phone.startsWith('+91')
    ? phone.slice(3)
    : phone.startsWith('91') && phone.length === 12
    ? phone.slice(2)
    : phone;

  const authToken = await getAuthToken();

  const url = new URL(`${BASE_URL}/verification/v3/send`);
  url.searchParams.set('countryCode',   COUNTRY);
  url.searchParams.set('customerId',    customerId);
  url.searchParams.set('flowType',      'SMS');
  url.searchParams.set('mobileNumber',  mobileNumber);
  url.searchParams.set('otpLength',     String(otpLength));

  logger.info(`[MessageCentral] Sending OTP to +91${mobileNumber}`);

  const response = await _request('POST', url.toString(), { authToken });

  // Response shape: { responseCode: '200', message: { verificationId: '...' } }
  const verificationId =
    response?.message?.verificationId ??
    response?.verificationId ??
    response?.data?.verificationId;

  if (!verificationId) {
    logger.error('[MessageCentral] sendOtp — unexpected response:', response);
    throw new Error(
      `[MessageCentral] Failed to send OTP: ${
        response?.message || JSON.stringify(response)
      }`
    );
  }

  logger.info(
    `[MessageCentral] OTP sent — verificationId: ${verificationId}`
  );
  return String(verificationId);
}

/**
 * Validate the OTP entered by the user.
 *
 * @param {string} phone          E.164 phone number
 * @param {string} verificationId The ID returned by sendOtp
 * @param {string} code           The OTP entered by the user
 * @returns {Promise<{success: boolean, responseCode: string, message: string}>}
 */
async function verifyOtp(phone, verificationId, code) {
  const customerId = process.env.MESSAGE_CENTRAL_CUSTOMER_ID;
  if (!customerId) {
    throw new Error(
      '[MessageCentral] MESSAGE_CENTRAL_CUSTOMER_ID is not set in environment'
    );
  }

  const mobileNumber = phone.startsWith('+91')
    ? phone.slice(3)
    : phone.startsWith('91') && phone.length === 12
    ? phone.slice(2)
    : phone;

  const authToken = await getAuthToken();

  const url = new URL(
    `${BASE_URL}/verification/v3/validateOtp`
  );
  url.searchParams.set('countryCode',    COUNTRY);
  url.searchParams.set('mobileNumber',   mobileNumber);
  url.searchParams.set('verificationId', String(verificationId));
  url.searchParams.set('customerId',     customerId);
  url.searchParams.set('code',           String(code));

  logger.info(
    `[MessageCentral] Validating OTP for +91${mobileNumber} — verificationId: ${verificationId}`
  );

  let response;
  try {
    response = await _request('GET', url.toString(), { authToken });
  } catch (err) {
    // Message Central returns 4xx for invalid OTP; we catch and surface cleanly
    logger.warn(`[MessageCentral] verifyOtp error: ${err.message}`);
    return { success: false, responseCode: '400', message: err.message };
  }

  // Response shape on success might vary, usually: { responseCode: '200', verificationStatus: 'VERIFICATION_COMPLETED' }
  const responseCode       = String(response?.responseCode ?? '');
  const verificationStatus = response?.verificationStatus ?? response?.data?.verificationStatus ?? response?.message?.verificationStatus ?? '';

  const success =
    responseCode === '200' &&
    (verificationStatus === 'VERIFICATION_COMPLETED' ||
      verificationStatus === 'VERIFIED');

  if (!success) {
    logger.warn(
      `[MessageCentral] OTP verification failed — responseCode: ${responseCode}, status: ${verificationStatus}`
    );
  } else {
    logger.info(
      `[MessageCentral] OTP verified successfully for +91${mobileNumber}`
    );
  }

  return {
    success,
    responseCode,
    message: verificationStatus || response?.message || 'Unknown',
  };
}

module.exports = { sendOtp, verifyOtp, getAuthToken };
