"use strict";

/* Counts what a supplier's page fetches: which hosts it talks to, how many
 * requests a run makes, how many failed. It only reads: the browser's own
 * requests are never changed, stopped or replayed, so what a shop sees is
 * exactly what Chrome sent.
 *
 * The supplier page feeds this from its request events (chrome-page.js); the
 * panel shows the totals. */

/* Hosts kept in the tally; beyond this they are counted as "(other)". */
const MAX_HOSTS = 40;
const OTHER = "(other)";


function createTrafficWatch({ now = Date.now } = {}) {
  const stats = { startedAt: now(), requests: 0, failed: 0, hosts: Object.create(null) };

  return {
    /** One request the page started. */
    request(url) {
      stats.requests += 1;
      let host = OTHER;
      try {
        host = new URL(url).hostname || OTHER;
      } catch {
        /* not an address this can read; still counted */
      }
      if (!(host in stats.hosts) && Object.keys(stats.hosts).length >= MAX_HOSTS) host = OTHER;
      stats.hosts[host] = (stats.hosts[host] || 0) + 1;
    },
    /** A response arrived; an error status counts as a failure. */
    completed(statusCode) {
      if (Number(statusCode) >= 400) stats.failed += 1;
    },
    /** The request never completed (blocked, offline, aborted by the page). */
    failed() {
      stats.failed += 1;
    },
    /** What the panel shows: counts only, never the addresses themselves. */
    stats() {
      return {
        startedAt: stats.startedAt,
        requests: stats.requests,
        failed: stats.failed,
        hosts: { ...stats.hosts },
      };
    },
  };
}


module.exports = { createTrafficWatch, MAX_HOSTS };
