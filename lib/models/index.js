/**
 * Central model registry. Import models from here (alias: @models):
 *   const { Order, Seller } = require("@models");
 */
module.exports = {
  Admin: require("./schema/Admin"),
  Client: require("./schema/Client"),
  Seller: require("./schema/Seller"),
  Product: require("./schema/Product"),
  Catalog: require("./schema/Catalog"),
  Order: require("./schema/Order"),
  UserAddress: require("./schema/UserAddress"),
  Cart: require("./schema/Cart"),
  DeviceToken: require("./schema/DeviceToken"),
  DeliveryAgent: require("./schema/DeliveryAgent"),
  NotificationCampaign: require("./schema/NotificationCampaign"),
  Feedback: require("./schema/Feedback"),
  PlatformSettings: require("./schema/PlatformSettings"),
  EarningLog: require("./schema/EarningLog"),
  Alert: require("./schema/Alert"),
  Review: require("./schema/Review"),
  Wishlist: require("./schema/Wishlist"),
  OtpSession: require("./schema/OtpSession"),
};
