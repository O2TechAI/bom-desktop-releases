"use strict";

/* Loaded by the app (BOM_DESKTOP_SUPPLIER_FIXTURES) in end-to-end runs: the
 * practice shops' profiles, on the ports the test started them on. */

const { practiceDigiKey } = require("./practice-digikey.cjs");
const { practiceSites } = require("./practice-shops.cjs");

const ports = JSON.parse(process.env.BOM_PRACTICE_PORTS || "{}");

module.exports = [...practiceSites(ports), ...(ports.dk ? [practiceDigiKey(ports.dk)] : [])];
