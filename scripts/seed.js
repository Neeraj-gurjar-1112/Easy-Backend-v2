require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const {
  Admin,
  Client,
  Seller,
  Product,
  Catalog,
  Order,
} = require("../lib/models");

/*
 * Seed script (debug friendly):
 *  - Ensures ONLY two privileged accounts (admin + one approved seller).
 *  - Restores a richer product catalog (general + a sample restaurant group)
 *    so the app's product / restaurant listing features can be exercised.
 *  - Does NOT create firebase_uid values (map them post-login with /api/auth/map-by-email).
 *  - Keeps existing Client documents (customer accounts) intact.
 *
 * If you need a fully clean slate including clients, pass WIPE_CLIENTS=1 when running.
 */

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

async function seed() {
  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB (seed)");

    console.log(
      "🧹 Clearing relevant collections (admins/sellers/products/catalogs/orders)..."
    );
    const wipeClients = process.env.WIPE_CLIENTS === "1";
    const deletions = [
      Admin.deleteMany({}),
      Seller.deleteMany({}),
      Product.deleteMany({}),
      Catalog.deleteMany({}),
      Order.deleteMany({}),
    ];
    if (wipeClients) deletions.push(Client.deleteMany({}));
    await Promise.all(deletions);

    console.log("🌱 Creating single demo admin...");
    const admin = await Admin.create({
      email: "admin@example.com",
      role: "superadmin",
      // Added default password for local/dev login. CHANGE in production.
      password: process.env.SEED_ADMIN_PASSWORD || "Admin@123",
    });

    console.log("🌱 Creating General Store seller (grocery)...");
    const generalSeller = await Seller.create({
      business_name: "General Store",
      email: "seller@example.com",
      phone: "7000000001",
      business_type: "grocery", // enum requires lowercase
      approved: true,
      address: "Bapu Bazaar, Udaipur, Rajasthan 313001",
      location: { lat: 24.5797, lng: 73.6907 }, // central market area
    });

    console.log("🌱 Creating catalog for General Store seller...");
    const [generalCatalog] = await Catalog.create([
      {
        seller_id: generalSeller._id,
        min_products_required: 1,
        published: true,
      },
    ]);

    console.log("🌱 Creating products (assigned to General Store seller)...");
    await Product.create([
      {
        seller_id: generalSeller._id,
        name: "Aashirvaad Atta 5kg",
        category: "Grocery",
        price: 250,
        stock: 40,
        status: "active",
        image:
          "https://encrypted-tbn2.gstatic.com/shopping?q=tbn:ANd9GcTGlcsDB26gEtdqctdqCjbzICerUJu43cNbpBqWRDhtLANkq3mC4deKe35kXPX2vroayGpUntPcfHaJlM_a5DbLMUVglbRMpIPSYU0Q3QK8JaVJt5car3Xl",
        description: "Premium quality wheat flour.",
      },
      {
        seller_id: generalSeller._id,
        name: "Amul Gold Milk 1L",
        category: "Grocery",
        price: 65,
        stock: 120,
        status: "active",
        image:
          "https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/540c3e2e-131d-43dc-8266-90a15aae8674/Amul-Gold-Full-Cream-Fresh-Milk-Pouch-.jpeg",
        description: "Fresh dairy milk.",
      },
      {
        seller_id: generalSeller._id,
        name: "Parle-G Biscuit",
        category: "Grocery",
        price: 10,
        stock: 0,
        status: "inactive",
        image:
          "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=300&h=300&fit=crop",
        description: "Classic tea-time biscuit.",
      },
      {
        seller_id: generalSeller._id,
        name: "Fortune Sunflower Oil 1L",
        category: "Grocery",
        price: 150,
        stock: 70,
        status: "active",
        image:
          "https://www.gorevizon.com/wp-content/uploads/2021/03/51TH5xE2sL.jpg",
        description: "Refined sunflower oil.",
      },
      {
        seller_id: generalSeller._id,
        name: "Tata Salt 1kg",
        category: "Grocery",
        price: 25,
        stock: 200,
        status: "active",
        image:
          "https://www.tatanutrikorner.com/cdn/shop/files/salt_ffa481ef-2b73-4a01-8112-5e72f6e3ee31.png?v=1748858210&width=493",
        description: "Iodized table salt.",
      },
      {
        seller_id: generalSeller._id,
        name: "Maggi Noodles 280g",
        category: "Grocery",
        price: 55,
        stock: 150,
        status: "active",
        image:
          "https://encrypted-tbn1.gstatic.com/shopping?q=tbn:ANd9GcSTkOQe4s4c83msgfjmOpI0aLd_IJToIziHCCBdjEulzS1knq27WCI6TbHJFNR0sEZlWO8Aws8GntQvppxr61GrA2QonPEswzs96J4Lny4c1WD5jfiTw-ShN3A",
        description: "Masala noodles family pack.",
      },
      {
        seller_id: generalSeller._id,
        name: "Tomatoes 1kg",
        category: "Vegetables",
        price: 40,
        stock: 90,
        status: "active",
        image:
          "https://images.pexels.com/photos/1327838/pexels-photo-1327838.jpeg?cs=srgb&dl=pexels-julia-nagy-568948-1327838.jpg&fm=jpg",
        description: "Fresh red tomatoes.",
      },
      {
        seller_id: generalSeller._id,
        name: "Potatoes 2kg",
        category: "Vegetables",
        price: 60,
        stock: 110,
        status: "active",
        image: "https://cdn.mos.cms.futurecdn.net/iC7HBvohbJqExqvbKcV3pP.jpg",
        description: "Clean and farm fresh.",
      },
      {
        seller_id: generalSeller._id,
        name: "Onions 1kg",
        category: "Vegetables",
        price: 35,
        stock: 130,
        status: "active",
        image:
          "https://cdn.pixabay.com/photo/2016/06/02/01/35/vegetables-1430062_640.jpg",
        description: "Purple onions.",
      },
    ]);

    console.log("🌱 Creating Restaurant sellers with distinct menus...");
    const restaurantSellers = await Seller.create([
      {
        business_name: "Spice Garden",
        email: "spicegarden@example.com",
        phone: "7000000010",
        business_type: "restaurant",
        approved: true,
        address: "Near Fateh Sagar Lake, Udaipur, Rajasthan 313001",
        cuisine: "North Indian",
        logo_url: "https://i.imgur.com/3QKXJ1S.jpg",
        banner_url: "https://i.imgur.com/2WZtYna.jpg",
        opening_hours: "11:00-23:00",
        delivery_radius_km: 6,
        location: { lat: 24.5943, lng: 73.6724 }, // Fateh Sagar area
      },
      {
        business_name: "Southern Bites",
        email: "southernbites@example.com",
        phone: "7000000011",
        business_type: "restaurant",
        approved: true,
        address: "Lake Pichola Road, Udaipur, Rajasthan 313001",
        cuisine: "South Indian",
        logo_url: "https://i.imgur.com/SlwK2rY.jpg",
        banner_url: "https://i.imgur.com/VUu6d2A.jpg",
        opening_hours: "07:00-22:00",
        delivery_radius_km: 5,
        location: { lat: 24.5764, lng: 73.6803 }, // near Lake Pichola
      },
      {
        business_name: "Bombay Chaat House",
        email: "chaathouse@example.com",
        phone: "7000000012",
        business_type: "restaurant",
        approved: true,
        address: "Surajpole, Udaipur, Rajasthan 313001",
        cuisine: "Street Food",
        logo_url: "https://i.imgur.com/1F5Vg0x.jpg",
        banner_url: "https://i.imgur.com/8tXyG8h.jpg",
        opening_hours: "12:00-21:30",
        delivery_radius_km: 4,
        location: { lat: 24.5749, lng: 73.6997 }, // Surajpole area
      },
    ]);

    console.log("🌱 Creating catalogs for restaurants...");
    const restaurantCatalogs = await Catalog.create(
      restaurantSellers.map((s) => ({
        seller_id: s._id,
        min_products_required: 1,
        published: true,
      }))
    );

    console.log(
      "🌱 Creating menus for each restaurant (Restaurants category only)..."
    );
    // Spice Garden
    await Product.create([
      {
        seller_id: restaurantSellers[0]._id,
        name: "Paneer Butter Masala",
        category: "Restaurants",
        price: 229,
        stock: 25,
        status: "active",
        image: "https://i.imgur.com/3QKXJ1S.jpg",
        description: "Rich creamy paneer curry.",
      },
      {
        seller_id: restaurantSellers[0]._id,
        name: "Dal Makhani",
        category: "Restaurants",
        price: 179,
        stock: 30,
        status: "active",
        image: "https://i.imgur.com/v9b9k6c.jpg",
        description: "Slow-cooked black lentils.",
      },
      {
        seller_id: restaurantSellers[0]._id,
        name: "Butter Naan",
        category: "Restaurants",
        price: 39,
        stock: 200,
        status: "active",
        image: "https://i.imgur.com/ab1D2pR.jpg",
        description: "Soft leavened bread.",
      },
    ]);
    // Southern Bites
    await Product.create([
      {
        seller_id: restaurantSellers[1]._id,
        name: "Masala Dosa",
        category: "Restaurants",
        price: 99,
        stock: 60,
        status: "active",
        image: "https://i.imgur.com/SlwK2rY.jpg",
        description: "Crispy dosa with potato.",
      },
      {
        seller_id: restaurantSellers[1]._id,
        name: "Idli Sambar (3pc)",
        category: "Restaurants",
        price: 79,
        stock: 80,
        status: "active",
        image: "https://i.imgur.com/8o3y2xA.jpg",
        description: "Steamed idlis with sambar.",
      },
      {
        seller_id: restaurantSellers[1]._id,
        name: "Filter Coffee",
        category: "Restaurants",
        price: 45,
        stock: 120,
        status: "active",
        image: "https://i.imgur.com/Z7c6vYV.jpg",
        description: "Strong and aromatic.",
      },
    ]);
    // Bombay Chaat House
    await Product.create([
      {
        seller_id: restaurantSellers[2]._id,
        name: "Pani Puri (6pc)",
        category: "Restaurants",
        price: 60,
        stock: 100,
        status: "active",
        image: "https://i.imgur.com/6Q8T3qG.jpg",
        description: "Tangy mint water puris.",
      },
      {
        seller_id: restaurantSellers[2]._id,
        name: "Sev Puri",
        category: "Restaurants",
        price: 70,
        stock: 90,
        status: "active",
        image: "https://i.imgur.com/VUu6d2A.jpg",
        description: "Crispy puris with toppings.",
      },
      {
        seller_id: restaurantSellers[2]._id,
        name: "Dahi Papdi Chaat",
        category: "Restaurants",
        price: 85,
        stock: 80,
        status: "active",
        image: "https://i.imgur.com/2WZtYna.jpg",
        description: "Papdi chaat with yogurt.",
      },
    ]);

    console.log("✅ Seed complete. Summary:");
    const counts = {
      generalProducts: await Product.countDocuments({
        seller_id: generalSeller._id,
      }),
      restaurantProducts: await Product.countDocuments({
        category: "Restaurants",
      }),
      totalSellers: await Seller.countDocuments({}),
    };
    console.log({
      admin: admin.email,
      generalSeller: generalSeller.email,
      generalCatalog: generalCatalog._id.toString(),
      restaurantSellerIds: restaurantSellers.map((s) => s._id.toString()),
      restaurantCatalogIds: restaurantCatalogs.map((c) => c._id.toString()),
      counts,
    });
    console.log(
      "👉 Map Firebase UIDs for admin@example.com, seller@example.com, spicegarden@example.com, southernbites@example.com, chaathouse@example.com."
    );
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

seed();
