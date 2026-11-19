"use strict";

/* The supplier sites the app can work on.
 *
 * A profile is data: the site's hosts and addresses, the targets its DOM
 * needs (merged over the common ones), its pages as a state machine
 * (machine.js), and its tasks: walks between those pages, plus what to do
 * or read on them.
 * Adding a supplier means adding a file here, not changing the driver. Write
 * a target map with `npx electron scripts/outline.cjs <url>`. */

const { COMMON_TARGETS, COMMON_TASKS, TASK_ORDER, TASK_PARAMS } = require("./common");
const { defineMachine } = require("../machine");
const { ACTIONS } = require("../runner");
const { challengeMayOpen, supplierMayOpen } = require("../supplier-session");

const digikey = require("./digikey");
const lcsc = require("./lcsc");
const mcmaster = require("./mcmaster");
const mouser = require("./mouser");
const tti = require("./tti");


function defineSite(site, { mayGo } = {}) {
  if (!/^[a-z0-9-]+$/.test(site.id)) throw new Error(`Bad supplier id ${site.id}`);
  for (const key of ["home", "search", "cart", "signIn"]) {
    if (!site.urls?.[key]) throw new Error(`${site.name} needs a ${key} address`);
  }
  const targets = { ...COMMON_TARGETS, ...site.targets };
  const tasks = { ...COMMON_TASKS, ...site.tasks };
  const order = [...TASK_ORDER.filter((name) => tasks[name]), ...Object.keys(tasks).filter((name) => !TASK_ORDER.includes(name))];
  const profile = {
    id: site.id,
    name: site.name,
    hosts: Object.freeze([...site.hosts]),
    urls: Object.freeze({ ...site.urls }),
    targets: Object.freeze(targets),
    machine: site.machine ? defineMachine(site.machine, { targets, actions: ACTIONS }) : null,
    tasks: Object.freeze(Object.fromEntries(order.map((name) => [name, tasks[name]]))),
    taskParams: Object.freeze({ ...TASK_PARAMS, ...site.taskParams }),
    taskDefaults: Object.freeze({ ...site.taskDefaults }),
    verified: Boolean(site.verified),
    mayGo: mayGo || ((url) => supplierMayOpen(url, site.hosts)),
    // The checkpoint pages (DataDome, Turnstile, …) the person may see.
    challengeMayGo: (url) => challengeMayOpen(url, site.challengeHosts),
  };
  return Object.freeze(profile);
}


const SITES = Object.freeze([digikey, mouser, lcsc, mcmaster, tti].map((site) => defineSite(site)));


function findSite(id, extra = []) {
  return [...SITES, ...extra].find((site) => site.id === id) || null;
}


module.exports = { SITES, defineSite, findSite };
