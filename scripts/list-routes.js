#!/usr/bin/env node
/**
 * Prints every registered HTTP route of an Express app as "METHOD /path", sorted.
 *
 *   node scripts/list-routes.js                 # combined app (app + admin + socket routes)
 *   node scripts/list-routes.js src/app         # one service
 *   node scripts/list-routes.js <file.js>       # any module exporting an express app/router
 *
 * Useful to diff the public URL surface before/after a refactor:
 *   node scripts/list-routes.js > routes-new.txt
 */
require("module-alias/register");
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const path = require("path");

const target = process.argv[2] || path.join(__dirname, "..", "app.js");
const mod = require(path.isAbsolute(target) ? target : path.join(process.cwd(), target));
const app = mod && mod.default ? mod.default : mod;

// Turn express's layer regexp back into a readable path segment.
function layerPath(layer) {
  if (layer.route) return layer.route.path;
  if (layer.path) return layer.path; // express 4 stores mount path for some layers
  const src = layer.regexp && layer.regexp.source;
  if (!src) return "";
  if (src === "^\\/?$" || src === "^\\/?(?=\\/|$)") return "";
  let p = src
    .replace(/^\^\\\//, "/")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ":param")
    .replace(/\\\//g, "/")
    .replace(/\$$/, "")
    .replace(/\/\?$/, "");
  // restore param names when express kept them
  if (layer.keys && layer.keys.length) {
    let i = 0;
    p = p.replace(/:param/g, () => ":" + (layer.keys[i++] ? layer.keys[i - 1].name : "param"));
  }
  return p;
}

function walk(stack, prefix, out) {
  for (const layer of stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const rp of routePaths) {
        for (const m of methods) out.push(`${m.toUpperCase().padEnd(6)} ${join(prefix, rp)}`);
      }
    } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
      walk(layer.handle.stack, join(prefix, layerPath(layer)), out);
    }
  }
}

function join(a, b) {
  const s = `${a || ""}/${b || ""}`.replace(/\/+/g, "/");
  return s.length > 1 ? s.replace(/\/$/, "") : s;
}

const stack = (app._router && app._router.stack) || (app.stack ? app.stack : null);
if (!stack) {
  console.error("Not an express app or router:", target);
  process.exit(1);
}
const out = [];
walk(stack, "", out);
const unique = [...new Set(out)].sort();
for (const line of unique) console.log(line);
console.error(`${unique.length} routes`);
process.exit(0);
