/**
 * Truckier-style response helpers, attached to `res` by createApp():
 *   res.success(data, message) 200 | res.warn(data, message) 200 with success:false
 *   res.badRequest 400 | res.unauthorized 401 | res.forbidden 403 | res.notFound 404 | res.serverError 500
 * Legacy routes still use res.json(); new code should prefer these for a consistent envelope.
 */
const HttpResponseCode = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
};

const Response = {
  success(data = {}, message = "") {
    return this.status(HttpResponseCode.OK).json({ success: true, data, message });
  },
  warn(data = {}, message = "") {
    return this.status(HttpResponseCode.OK).json({ success: false, data, message });
  },
  badRequest(data = {}, message = "") {
    return this.status(HttpResponseCode.BAD_REQUEST).json({ success: false, data, message });
  },
  unauthorized(data = {}, message = "") {
    return this.status(HttpResponseCode.UNAUTHORIZED).json({ success: false, data, message });
  },
  forbidden(data = {}, message = "") {
    return this.status(HttpResponseCode.FORBIDDEN).json({ success: false, data, message });
  },
  notFound(data = {}, message = "") {
    return this.status(HttpResponseCode.NOT_FOUND).json({ success: false, data, message });
  },
  serverError(data = {}, message = "", err = null) {
    if (err) console.error("Server-Error:", err);
    return this.status(HttpResponseCode.SERVER_ERROR).json({ success: false, data, message });
  },
};

function responseHelpers() {
  return (req, res, next) => {
    for (const key of Object.keys(Response)) res[key] = Response[key];
    next();
  };
}

module.exports = { HttpResponseCode, Response, responseHelpers };
