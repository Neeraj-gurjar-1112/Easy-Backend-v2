// UPI functionality removed (COD only). Kept as explicit no-ops so accidental usage fails loudly.
function buildUpiLink() {
  throw new Error("UPI has been removed. Use COD only.");
}
function getUpiEnv() {
  throw new Error("UPI has been removed. Use COD only.");
}
module.exports = { buildUpiLink, getUpiEnv };
