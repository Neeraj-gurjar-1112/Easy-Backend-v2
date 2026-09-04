'use strict';

/**
 * OTP controller (mount: /api/auth/otp). Handlers copied verbatim from the
 * legacy routes/otp.js. Handles all phone-based OTP flows:
 *
 *   POST /api/auth/otp/send    — Request OTP via Message Central
 *   POST /api/auth/otp/verify  — Verify OTP; returns JWT or phoneVerifiedToken
 *
 * Rate limiting is applied at the app level (authLimiter on /api/auth/*).
 * Additional per-phone brute-force protection is enforced inside this file.
 */

const jwt      = require('jsonwebtoken');
const { Client, OtpSession } = require('@models');
const mc       = require('@sms/messageCentral');
const logger   = require('@util/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const OTP_LENGTH           = 6;
const OTP_TTL_MINUTES      = 10;
const MAX_FAILED_ATTEMPTS  = 5;
const LOCK_DURATION_MS     = 15 * 60 * 1000; // 15 minutes
const PHONE_VERIFIED_TOKEN_EXPIRY = '30m'; // short-lived for signup completion

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalise raw phone input to E.164 (+91XXXXXXXXXX). */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (raw && raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET environment variable not set');
  return s;
}

class OtpController {
  /**
   * POST /send — Request an OTP to be sent via SMS.
   *
   * Body: { phone: string, purpose: 'client_login' | 'partner_signup' }
   *
   * Response 200: { success: true, message: 'OTP sent' }
   */
  async send(req, res) {
    try {
      const { phone: rawPhone, purpose } = req.body || {};

      // ── Validation ──
      if (!rawPhone) {
        return res.status(400).json({ error: 'phone is required' });
      }
      if (!['client_login', 'partner_signup'].includes(purpose)) {
        return res.status(400).json({
          error: "purpose must be 'client_login' or 'partner_signup'",
        });
      }

      const phone = normalizePhone(rawPhone);
      if (!phone) {
        return res.status(400).json({
          error: 'Invalid phone number. Provide a 10-digit Indian mobile number.',
        });
      }

      // if (purpose === 'client_login') {
      //   const clientExists = await Client.findOne({ phone });
      //   if (!clientExists) {
      //     return res.status(404).json({ error: 'Account not found', message: 'create account' });
      //   }
      // }

      // ── Brute-force guard: check existing session ──
      const existing = await OtpSession.findOne({ phone, purpose });
      if (existing && existing.lockedUntil && existing.lockedUntil > new Date()) {
        const waitSec = Math.ceil((existing.lockedUntil - Date.now()) / 1000);
        return res.status(429).json({
          error: `Too many failed attempts. Please wait ${waitSec} seconds before requesting a new OTP.`,
        });
      }

      // ── Call Message Central ──
      let verificationId;
      try {
        verificationId = await mc.sendOtp(phone, OTP_LENGTH);
      } catch (mcErr) {
        console.log(mcErr);
        logger.error(`[OTP/send] Message Central error: ${mcErr.message}`);

        if (mcErr.message && mcErr.message.includes('REQUEST_ALREADY_EXISTS')) {
          return res.status(429).json({
            error: 'An OTP was recently sent. Please wait before requesting a new one.',
          });
        }

        return res.status(502).json({
          error: 'Failed to send OTP. Please try again.',
        });
      }

      // ── Upsert OtpSession ──
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
      await OtpSession.findOneAndUpdate(
        { phone, purpose },
        {
          phone,
          purpose,
          verificationId,
          expiresAt,
          failedAttempts: 0,
          lockedUntil: null,
          phoneVerifiedToken: null,
          created_at: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      logger.info(`[OTP/send] OTP sent — phone=${phone} purpose=${purpose}`);
      return res.json({ success: true, message: 'OTP sent successfully' });
    } catch (err) {
      logger.error('[OTP/send] Unexpected error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /verify — Verify the OTP entered by the user.
   *
   * Body: { phone: string, code: string, purpose: 'client_login' | 'partner_signup' }
   *
   * Response (client_login):
   *   { success: true, token: string, user: { _id, phone, name, role: 'client' } }
   *
   * Response (partner_signup):
   *   { success: true, phoneVerifiedToken: string }
   */
  async verify(req, res) {
    try {
      const { phone: rawPhone, code, purpose } = req.body || {};

      // ── Validation ──
      if (!rawPhone || !code || !purpose) {
        return res.status(400).json({ error: 'phone, code, and purpose are required' });
      }
      if (!['client_login', 'partner_signup'].includes(purpose)) {
        return res.status(400).json({
          error: "purpose must be 'client_login' or 'partner_signup'",
        });
      }
      if (!/^\d{4,8}$/.test(String(code).trim())) {
        return res.status(400).json({ error: 'OTP must be a 4–8 digit number' });
      }

      const phone = normalizePhone(rawPhone);
      if (!phone) {
        return res.status(400).json({ error: 'Invalid phone number' });
      }

      // ── Find OtpSession ──
      const session = await OtpSession.findOne({ phone, purpose });
      if (!session) {
        return res.status(400).json({
          error: 'No active OTP session found. Please request a new OTP.',
        });
      }
      if (session.expiresAt < new Date()) {
        await OtpSession.deleteOne({ _id: session._id });
        return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
      }

      // ── Brute-force guard ──
      if (session.lockedUntil && session.lockedUntil > new Date()) {
        const waitSec = Math.ceil((session.lockedUntil - Date.now()) / 1000);
        return res.status(429).json({
          error: `Account temporarily locked. Please wait ${waitSec} seconds.`,
        });
      }

      // ── Validate via Message Central ──
      const result = await mc.verifyOtp(phone, session.verificationId, String(code).trim());

      if (!result.success) {
        // Increment failed attempts and possibly lock
        session.failedAttempts = (session.failedAttempts || 0) + 1;
        if (session.failedAttempts >= MAX_FAILED_ATTEMPTS) {
          session.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
          logger.warn(
            `[OTP/verify] Phone ${phone} locked after ${MAX_FAILED_ATTEMPTS} failed attempts`
          );
        }
        await session.save();
        return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
      }

      // ── OTP verified ─────────────────────────────────────────────────────────

      if (purpose === 'partner_signup') {
        // Issue a short-lived phoneVerifiedToken that the signup form will send
        // with the rest of the registration data.
        const phoneVerifiedToken = jwt.sign(
          { phone, purpose: 'partner_signup', verified: true },
          getJwtSecret(),
          { expiresIn: PHONE_VERIFIED_TOKEN_EXPIRY }
        );
        session.phoneVerifiedToken = phoneVerifiedToken;
        await session.save();

        logger.info(`[OTP/verify] partner_signup — phone verified: ${phone}`);
        return res.json({ success: true, phoneVerifiedToken });
      }

      // ── client_login: find or create Client ──────────────────────────────────
      let client = await Client.findOne({ phone });

      if (!client) {
        client = new Client({ phone, otp_verified: true });
        await client.save();
      } else {
        // Mark OTP verified on existing client
        if (!client.otp_verified) {
          client.otp_verified = true;
          await client.save();
        }
      }

      // Issue JWT for the session
      const token = jwt.sign(
        {
          id:   client._id.toString(),
          role: 'client',
          phone,
        },
        getJwtSecret(),
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || '30d' }
      );

      // Clean up OtpSession
      await OtpSession.deleteOne({ _id: session._id });

      logger.info(`[OTP/verify] Client login — _id: ${client._id}`);

      return res.json({
        success: true,
        token,
        user: {
          _id:              client._id,
          phone:            client.phone,
          name:             client.name || null,
          profile_completed: client.profile_completed,
          role:             'client',
        },
      });
    } catch (err) {
      logger.error('[OTP/verify] Unexpected error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new OtpController();
