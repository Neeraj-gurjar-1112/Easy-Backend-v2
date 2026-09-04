/**
 * EarningsController - delivery agent API (mounted at /api/delivery).
 * Handler bodies copied verbatim from legacy routes/delivery.js; only require paths changed.
 */
const mongoose = require("mongoose");
const { Order, EarningLog } = require("@models");
const { _calculateAgentEarning } = require("./helpers");

class EarningsController {
  /**
   * --------------- Delivery Agent Earnings ---------------
   * Summary for delivery agent: product amount (0 for agent), delivery amount (delivery_charge), profit (agent share)
   * Legacy: GET /api/delivery/:agentId/earnings/summary
   */
  async summary(req, res, next) {
    try {
      const { agentId } = req.params;
      if (!agentId || !mongoose.isValidObjectId(agentId)) {
        return res.status(400).json({ error: "valid agentId required" });
      }
      const { from, to } = req.query;

      // Build query for delivered orders
      const orderQuery = {
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_status": "delivered",
        "payment.method": "COD", // Only COD orders
      };
      if (from || to) {
        orderQuery["delivery.delivery_end_time"] = {};
        if (from) orderQuery["delivery.delivery_end_time"].$gte = new Date(from);
        if (to) orderQuery["delivery.delivery_end_time"].$lte = new Date(to);
      }

      const deliveredOrders = await Order.find(orderQuery)
        .select("payment.amount delivery.delivery_charge applied_discount_amount")
        .lean();

      // Calculate totals
      let totalCodCollected = 0;
      let totalDeliveryCharges = 0;
      let totalAgentEarnings = 0;

      for (const order of deliveredOrders) {
        const itemsAmount = Number(order.payment?.amount || 0);
        const deliveryCharge = Number(order.delivery?.delivery_charge || 0);
        const discount = Number(order.applied_discount_amount || 0);

        // Total COD collected from customer = items + delivery - discount
        const codAmount = Math.max(0, itemsAmount + deliveryCharge - discount);
        totalCodCollected += codAmount;

        // Track delivery charges
        totalDeliveryCharges += deliveryCharge;

        // Agent gets 80% of delivery charge OR admin compensation for free deliveries
        const agentEarning = await _calculateAgentEarning(deliveryCharge, order);
        totalAgentEarnings += agentEarning;
      }

      // Amount agent needs to pay to company = COD collected - agent earnings
      const amountToPayCompany = totalCodCollected - totalAgentEarnings;

      res.json({
        from: from || null,
        to: to || null,
        wallet_balance: +totalCodCollected.toFixed(2), // Total cash collected from customers
        total_cod_collected: +totalCodCollected.toFixed(2), // Same as wallet balance
        total_delivery_charges: +totalDeliveryCharges.toFixed(2),
        agent_earnings: +totalAgentEarnings.toFixed(2), // Agent's 80% share of delivery charges
        amount_to_pay_company: +amountToPayCompany.toFixed(2), // Items + platform's 20% of delivery
        total_orders_delivered: deliveredOrders.length,
        // Legacy fields for backward compatibility
        product_amount: 0,
        delivery_amount: +totalDeliveryCharges.toFixed(2),
        profit: +totalAgentEarnings.toFixed(2),
      });
    } catch (e) {
      console.error("agent earnings summary error", e);
      res.status(500).json({ error: "failed to compute earnings" });
    }
  }

  /**
   * Detailed earnings breakdown for delivery agent
   * Returns per-day totals and per-order entries for delivered COD orders
   * Legacy: GET /api/delivery/:agentId/earnings/breakdown
   */
  async breakdown(req, res, next) {
    try {
      const { agentId } = req.params;
      if (!agentId || !mongoose.isValidObjectId(agentId)) {
        return res.status(400).json({ error: "valid agentId required" });
      }
      const { from, to } = req.query;

      // Build query for delivered orders (COD only)
      const orderQuery = {
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_status": "delivered",
        "payment.method": "COD",
      };
      if (from || to) {
        orderQuery["delivery.delivery_end_time"] = {};
        if (from) orderQuery["delivery.delivery_end_time"].$gte = new Date(from);
        if (to) orderQuery["delivery.delivery_end_time"].$lte = new Date(to);
      }

      const orders = await Order.find(orderQuery)
        .select(
          "seller_id payment.amount delivery.delivery_charge delivery.delivery_end_time applied_discount_amount",
        )
        .populate("seller_id", "business_name")
        .lean();

      // Accumulators
      let totalCodCollected = 0;
      let totalDeliveryCharges = 0;
      let totalAgentEarnings = 0;

      // Per-day map
      const byDay = new Map(); // key: YYYY-MM-DD => { date, orders, cod_collected, agent_earnings, amount_to_pay_company }

      const ordersOut = [];

      for (const o of orders) {
        const itemsAmount = Number(o?.payment?.amount || 0);
        const deliveryCharge = Number(o?.delivery?.delivery_charge || 0);
        const discount = Number(o?.applied_discount_amount || 0);
        const agentEarning = await _calculateAgentEarning(deliveryCharge, o);
        const codCollected = Math.max(0, itemsAmount + deliveryCharge - discount);
        const toCompany = codCollected - agentEarning;

        totalCodCollected += codCollected;
        totalDeliveryCharges += deliveryCharge;
        totalAgentEarnings += agentEarning;

        const endTime = o?.delivery?.delivery_end_time
          ? new Date(o.delivery.delivery_end_time)
          : null;
        const yyyyMmDd = endTime
          ? new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate())
              .toISOString()
              .slice(0, 10)
          : "unknown";

        const dayObj = byDay.get(yyyyMmDd) || {
          date: yyyyMmDd,
          orders: 0,
          cod_collected: 0,
          agent_earnings: 0,
          amount_to_pay_company: 0,
        };
        dayObj.orders += 1;
        dayObj.cod_collected += codCollected;
        dayObj.agent_earnings += agentEarning;
        dayObj.amount_to_pay_company += toCompany;
        byDay.set(yyyyMmDd, dayObj);

        ordersOut.push({
          order_id: o._id,
          delivered_at: endTime,
          store:
            (o.seller_id && (o.seller_id.business_name || o.seller_id.name)) ||
            undefined,
          items_amount: +itemsAmount.toFixed(2),
          delivery_charge: +deliveryCharge.toFixed(2),
          cod_collected: +codCollected.toFixed(2),
          agent_earning: +agentEarning.toFixed(2),
          amount_to_pay_company: +toCompany.toFixed(2),
        });
      }

      const byDayOut = Array.from(byDay.values())
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .map((d) => ({
          ...d,
          cod_collected: +Number(d.cod_collected || 0).toFixed(2),
          agent_earnings: +Number(d.agent_earnings || 0).toFixed(2),
          amount_to_pay_company: +Number(d.amount_to_pay_company || 0).toFixed(2),
        }));

      const amountToPayCompany = totalCodCollected - totalAgentEarnings;

      res.json({
        from: from || null,
        to: to || null,
        totals: {
          total_orders: orders.length,
          total_cod_collected: +totalCodCollected.toFixed(2),
          total_delivery_charges: +totalDeliveryCharges.toFixed(2),
          agent_earnings: +totalAgentEarnings.toFixed(2),
          amount_to_pay_company: +amountToPayCompany.toFixed(2),
        },
        by_day: byDayOut,
        orders: ordersOut,
      });
    } catch (e) {
      console.error("agent earnings breakdown error", e);
      res.status(500).json({ error: "failed to compute earnings breakdown" });
    }
  }

  /**
   * Logs
   * Legacy: GET /api/delivery/:agentId/earnings/logs
   */
  async logs(req, res, next) {
    try {
      const { agentId } = req.params;
      if (!agentId || !mongoose.isValidObjectId(agentId)) {
        return res.status(400).json({ error: "valid agentId required" });
      }
      const { from, to } = req.query;
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
      const skip = (page - 1) * limit;
      const q = { role: "delivery", agent_id: agentId };
      if (from || to) {
        q.created_at = {};
        if (from) q.created_at.$gte = new Date(from);
        if (to) q.created_at.$lte = new Date(to);
      }
      const [items, total] = await Promise.all([
        EarningLog.find(q)
          .sort({ created_at: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        EarningLog.countDocuments(q),
      ]);
      res.json({ page, limit, total, items });
    } catch (e) {
      console.error("agent earnings logs error", e);
      res.status(500).json({ error: "failed to fetch earnings logs" });
    }
  }
}

module.exports = new EarningsController();
