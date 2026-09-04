const mongoose = require("mongoose");
const { Seller } = require("@models");
const {
  reverseGeocode,
  placeDetails,
  ENABLED: GEO_FALLBACK_ENABLED,
} = require("@util/geocode");
const { parsePagination, _deleteSellerCascade } = require("../../util/helpers");

class SellersController {
  // ---------------- Sellers ----------------
  async list(req, res) {
    try {
      // Support both: pending=true and status=pending (legacy)
      const isPendingParam =
        req.query.pending === "1" ||
        req.query.pending === "true" ||
        req.query.status === "pending";
      const { search } = req.query;
      const filter = isPendingParam ? { approved: { $ne: true } } : {};
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { business_name: rx },
          { email: rx },
          { phone: rx },
          { business_type: rx },
        ];
      }

      // Legacy behavior: if status=pending is provided and no pagination expected, return a bare array
      const legacyList =
        req.query.status === "pending" && !req.query.page && !req.query.limit;
      if (legacyList) {
        const rows = await Seller.find(filter)
          .sort({ created_at: -1 })
          .select(
            "business_name email phone business_type approved created_at address place_id location delivery_fee",
          )
          .lean();
        return res.json(rows);
      }

      // Default: paginated response
      const { page, limit, skip } = parsePagination(req);
      const [total, rows] = await Promise.all([
        Seller.countDocuments(filter),
        Seller.find(filter)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .select(
            "business_name email phone business_type approved created_at address place_id location delivery_fee",
          )
          .lean(),
      ]);
      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin sellers list error", e);
      res.status(500).json({ message: "Failed to list sellers" });
    }
  }

  async approve(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid seller id" });
      const seller = await Seller.findByIdAndUpdate(
        id,
        { $set: { approved: true } },
        { new: true },
      );
      if (!seller) return res.status(404).json({ error: "seller not found" });
      res.json(seller);
    } catch (e) {
      console.error("Error approving seller", e);
      res.status(500).json({ error: "failed to approve seller" });
    }
  }

  // ---------------- Seller Address Admin Helpers ----------------
  // Get a seller by id (address/location/place_id included)
  async getOne(req, res) {
    try {
      const { sellerId } = req.params;
      if (!mongoose.isValidObjectId(sellerId))
        return res.status(400).json({ error: "invalid seller id" });
      const seller = await Seller.findById(sellerId).select(
        "business_name email phone address location place_id approved delivery_fee created_at",
      );
      if (!seller) return res.status(404).json({ error: "seller not found" });
      res.json({ seller });
    } catch (e) {
      res.status(500).json({
        error: "failed to fetch seller",
        details: e?.message || String(e),
      });
    }
  }

  // Test pickup string resolution for a seller (mirrors delivery endpoints logic)
  async testPickup(req, res) {
    try {
      const { sellerId } = req.params;
      if (!mongoose.isValidObjectId(sellerId))
        return res.status(400).json({ error: "invalid seller id" });
      const s = await Seller.findById(sellerId)
        .select("address location place_id business_name")
        .lean();
      if (!s) return res.status(404).json({ error: "seller not found" });
      let source = "none";
      let pickup = null;
      if (s.address && String(s.address).trim()) {
        pickup = s.address;
        source = "address";
      }
      if (!pickup && GEO_FALLBACK_ENABLED && s.place_id) {
        try {
          const pd = await placeDetails(s.place_id);
          if (pd) {
            pickup = pd;
            source = "place_id";
          }
        } catch (_) {}
      }
      if (
        !pickup &&
        GEO_FALLBACK_ENABLED &&
        s.location &&
        s.location.lat != null &&
        s.location.lng != null
      ) {
        try {
          const rg = await reverseGeocode(
            Number(s.location.lat),
            Number(s.location.lng),
          );
          if (rg) {
            pickup = rg;
            source = "reverse_geocode";
          }
        } catch (_) {}
      }
      if (
        !pickup &&
        s.location &&
        s.location.lat != null &&
        s.location.lng != null
      ) {
        pickup = `${Number(s.location.lat).toFixed(5)}, ${Number(
          s.location.lng,
        ).toFixed(5)}`;
        source = "coords";
      }
      if (!pickup) {
        pickup = "Store address";
      }
      res.json({
        seller_id: sellerId,
        business_name: s.business_name,
        pickup_address: pickup,
        source,
        fallback_enabled: GEO_FALLBACK_ENABLED,
      });
    } catch (e) {
      res.status(500).json({
        error: "failed to test pickup",
        details: e?.message || String(e),
      });
    }
  }

  // Minimal Admin UI page (no auth on HTML; protected JSON calls require Authorization header)
  uiSellers(req, res) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Admin • Sellers</title>
<style>body{font-family:system-ui,Segoe UI,Arial;margin:20px} input,button{font-size:14px} .row{margin:8px 0} .card{border:1px solid #ddd;border-radius:8px;padding:12px;margin:8px 0}</style>
</head><body>
<h2>Admin • Sellers</h2>
<div class="row">Admin JWT: <input id="tok" type="password" style="width:420px" placeholder="Bearer token"/></div>
<div class="row">Search: <input id="q" style="width:320px" placeholder="name/email/phone"/> <button onclick="search()">Search</button></div>
<div id="results"></div>
<hr/>
<div class="card">
  <div class="row">Seller ID: <input id="sid" style="width:360px"/></div>
  <div class="row">Address: <input id="addr" style="width:460px"/></div>
  <div class="row">Lat: <input id="lat" style="width:120px"/> Lng: <input id="lng" style="width:120px"/> Place ID: <input id="pid" style="width:260px"/></div>
  <div class="row"><button onclick="loadSeller()">Load</button> <button onclick="saveSeller()">Save</button> <button onclick="testPickup()">Test pickup</button></div>
  <pre id="out" style="white-space:pre-wrap"></pre>
</div>
<script>
const base = location.origin + '/api/admin';
function h(){ const t=document.getElementById('tok').value.trim(); return t?{ 'Authorization':'Bearer '+t, 'Content-Type':'application/json' }:{ 'Content-Type':'application/json' }; }
async function search(){
  const q=document.getElementById('q').value.trim(); const r=document.getElementById('results'); r.textContent='Loading...';
  const u= base + '/sellers?search=' + encodeURIComponent(q) + '&limit=10&page=1';
  const res= await fetch(u,{ headers:h() }); const js= await res.json(); if(!res.ok){ r.textContent=JSON.stringify(js,null,2); return; }
  const rows= js.rows || js; r.innerHTML = rows.map(x => (
    '<div class="card">'
    + '<b>' + (x.business_name || '-') + '</b><br/>'
    + (x.email || '') + ' ' + (x.phone || '') + '<br/>'
    + '<small>' + x._id + '</small><br/>'
    + '<button onclick="pick(\'' + x._id + '\')">Select</button>'
    + '</div>'
  )).join('');
}
function pick(id){ document.getElementById('sid').value=id; loadSeller(); }
async function loadSeller(){
  const id=document.getElementById('sid').value.trim(); if(!id) return;
  const res= await fetch(base + '/sellers/' + id, { headers:h() }); const js= await res.json();
  document.getElementById('out').textContent = JSON.stringify(js,null,2);
  if(js.seller){ const s=js.seller; document.getElementById('addr').value = s.address||''; document.getElementById('lat').value = s.location?.lat??''; document.getElementById('lng').value = s.location?.lng??''; document.getElementById('pid').value = s.place_id||''; }
}
async function saveSeller(){
  const id=document.getElementById('sid').value.trim(); if(!id) return;
  const body={ address:document.getElementById('addr').value.trim(), lat:document.getElementById('lat').value, lng:document.getElementById('lng').value, place_id:document.getElementById('pid').value.trim() };
  const res= await fetch(base + '/sellers/' + id, { method:'PATCH', headers:h(), body: JSON.stringify(body) }); const js= await res.json();
  document.getElementById('out').textContent = JSON.stringify(js,null,2);
}
async function testPickup(){
  const id=document.getElementById('sid').value.trim(); if(!id) return;
  const res= await fetch(base + '/sellers/' + id + '/test-pickup', { headers:h() }); const js= await res.json();
  document.getElementById('out').textContent = JSON.stringify(js,null,2);
}
</script>
</body></html>`);
  }

  async remove(req, res) {
    try {
      const { id } = req.params;
      const full = req.query.full === "1" || req.query.full === "true";
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid seller id" });
      const seller = await Seller.findById(id);
      if (!seller) return res.status(404).json({ error: "seller not found" });
      await seller.deleteOne();
      const cascade = await _deleteSellerCascade(seller, {}, full);
      res.json({ message: "Seller deleted", full, cascade });
    } catch (error) {
      console.error("delete seller error", error);
      res.status(500).json({ error: "Failed to delete seller" });
    }
  }

  // ---------------- SELLER CRUD ----------------
  async create(req, res) {
    try {
      const {
        business_name,
        email,
        phone,
        business_type,
        approved,
        address,
        business_address, // compatibility from frontend
        cuisine,
        logo_url,
        banner_url,
        opening_hours,
        location,
        delivery_radius_km,
        delivery_fee,
        password, // optional admin-set password for seller login (plaintext)
      } = req.body;

      const finalAddress = business_address || address;
      // Require location (lat,lng) as well as address so delivery/tracking works
      const hasLocation =
        location &&
        typeof location === "object" &&
        location.lat !== undefined &&
        location.lng !== undefined;
      if (!business_name || !email || !phone || !finalAddress || !hasLocation) {
        return res.status(400).json({
          error:
            "Business name, email, phone, address and location (lat,lng) are required",
        });
      }

      const newSeller = new Seller({
        business_name,
        email,
        phone,
        business_type,
        approved: approved || false,
        address: finalAddress,
        cuisine,
        logo_url,
        banner_url,
        opening_hours,
        location: hasLocation
          ? { lat: Number(location.lat), lng: Number(location.lng) }
          : undefined,
        delivery_radius_km,
        delivery_fee: delivery_fee != null ? Number(delivery_fee) : 0,
        ...(password ? { password } : {}),
      });

      await newSeller.save();
      res.status(201).json(newSeller);
    } catch (error) {
      // Duplicate key error (email already exists)
      if (error.code === 11000) {
        console.error("Seller creation failed - duplicate email:", {
          email: req.body.email,
          error: error.message,
        });
        return res.status(400).json({ error: "Email already exists" });
      }

      // Mongoose validation errors
      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors)
          .map((e) => e.message)
          .join(", ");
        console.error("Seller creation validation failed:", {
          business_name: req.body.business_name,
          email: req.body.email,
          phone: req.body.phone,
          address: req.body.business_address || req.body.address,
          location: req.body.location,
          validationErrors,
        });
        return res.status(400).json({
          error: `Validation failed: ${validationErrors}`,
        });
      }

      // General errors with detailed logging
      console.error("Seller creation error:", {
        business_name: req.body.business_name,
        email: req.body.email,
        phone: req.body.phone,
        address: req.body.business_address || req.body.address,
        hasLocation: !!(
          req.body.location &&
          req.body.location.lat &&
          req.body.location.lng
        ),
        errorMessage: error.message,
        errorStack: error.stack,
      });
      res.status(500).json({
        error: "Failed to create seller",
        details: error.message,
      });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid seller ID" });
      }

      const updatedSeller = await Seller.findByIdAndUpdate(
        id,
        { $set: req.body },
        { new: true, runValidators: true },
      );

      if (!updatedSeller) {
        return res.status(404).json({ error: "Seller not found" });
      }

      res.json(updatedSeller);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: "Email already exists" });
      }
      console.error("update seller error", error);
      res.status(500).json({ error: "Failed to update seller" });
    }
  }

  // Backward compatible PATCH for updating seller (frontend calls PATCH)
  async patch(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid seller ID" });
      }

      // Use .findById() + .save() pattern for reliable unique index enforcement
      const seller = await Seller.findById(id);
      if (!seller) {
        return res.status(404).json({ error: "Seller not found" });
      }

      // Check for duplicate email if email is being updated
      if (req.body.email && req.body.email !== seller.email) {
        const existingSeller = await Seller.findOne({
          email: req.body.email,
          _id: { $ne: id },
        });
        if (existingSeller) {
          return res.status(400).json({ error: "Email already exists" });
        }
      }

      // Apply updates
      Object.assign(seller, req.body);

      // Save with validation (enforces unique indexes)
      const updatedSeller = await seller.save();

      res.json(updatedSeller);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: "Email already exists" });
      }
      console.error("patch seller error", error);
      res.status(500).json({ error: "Failed to update seller" });
    }
  }
}

module.exports = new SellersController();
