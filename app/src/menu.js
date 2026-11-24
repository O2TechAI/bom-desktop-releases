"use strict";

/* The application menu. Roles give the platform's own labels and shortcuts
 * (copy and paste need an Edit menu on macOS). Developer tools exist only in
 * an unpacked development run. Suppliers opens a supplier's own window
 * (automation/window.js). */

function buildMenuTemplate({ platform, packaged, t, openInBrowser, suppliers = [], openSupplier = () => {} }) {
  const isMac = platform === "darwin";
  const view = [
    { role: "reload" },
    { role: "forceReload" },
    ...(packaged ? [] : [{ role: "toggleDevTools" }]),
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  return [
    ...(isMac ? [{ role: "appMenu" }] : [{ role: "fileMenu" }]),
    { role: "editMenu" },
    { role: "viewMenu", submenu: view },
    ...(suppliers.length ? [{
      label: t("suppliers"),
      submenu: suppliers.map((site) => ({ label: site.name, click: () => openSupplier(site.id) })),
    }] : []),
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: t("open_in_browser"), click: openInBrowser }] },
  ];
}


module.exports = { buildMenuTemplate };
