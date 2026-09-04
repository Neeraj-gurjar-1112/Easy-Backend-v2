class MiscController {
  /** Minimum / latest app version gate used by the Flutter apps on launch. */
  appVersion(req, res) {
    res.json({
      minVersion: "1.0.5",
      minBuildNumber: 10,
      latestVersion: "1.0.5",
      latestBuildNumber: 10,
      updateRequired: false,
      updateMessage: "A new version is available with bug fixes and improvements.",
    });
  }

  debugVerifyToken(req, res) {
    res.json({ message: "Firebase Auth removed. Use /api/auth/user/me with Bearer JWT." });
  }
}

module.exports = new MiscController();
