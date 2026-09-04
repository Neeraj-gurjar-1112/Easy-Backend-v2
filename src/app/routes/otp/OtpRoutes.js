'use strict';

const express = require('express');
const OtpController = require('./OtpController');

const router = express.Router();

// POST /api/auth/otp/send    — Request OTP via Message Central
router.post('/send', OtpController.send);

// POST /api/auth/otp/verify  — Verify OTP; returns JWT or phoneVerifiedToken
router.post('/verify', OtpController.verify);

module.exports = router;
