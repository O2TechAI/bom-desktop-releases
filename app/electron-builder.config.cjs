// Packaging for O2 BOM desktop. Signing and the update feed come from the
// environment, so the same config builds an unsigned local test package and
// a signed release (see README.md, "Release").
//
// macOS signing:   CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application)
// macOS notarize:  APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
// Windows signing: AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET
//                  with BOM_DESKTOP_AZURE_ENDPOINT, _ACCOUNT and _PROFILE
//                  (Azure Trusted Signing), or CSC_LINK for a .pfx
// Update feed:     the public repository O2TechAI/bom-desktop-releases, or
//                  BOM_DESKTOP_UPDATE_URL (https, generic provider)

const env = process.env;

const notarize = Boolean(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER);
const azureSign = env.BOM_DESKTOP_AZURE_ENDPOINT && env.BOM_DESKTOP_AZURE_ACCOUNT && env.BOM_DESKTOP_AZURE_PROFILE
  ? {
    endpoint: env.BOM_DESKTOP_AZURE_ENDPOINT,
    codeSigningAccountName: env.BOM_DESKTOP_AZURE_ACCOUNT,
    certificateProfileName: env.BOM_DESKTOP_AZURE_PROFILE,
  }
  : undefined;
const updateUrl = env.BOM_DESKTOP_UPDATE_URL;
if (updateUrl && !updateUrl.startsWith("https://")) {
  throw new Error("BOM_DESKTOP_UPDATE_URL must be an https URL");
}
// A Mac build installs its own updates only when signed and notarized.
const signedMac = Boolean(env.CSC_LINK) && notarize;

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "ai.o2tech.bom.desktop",
  productName: "O2 BOM",
  copyright: "Copyright © O2 Tech AI",
  directories: { output: "release", buildResources: "build" },
  files: ["package.json", "src/**/*", "static/**/*"],
  asar: true,
  // Read by src/updater.js through package.json.
  extraMetadata: { bomSignedMac: signedMac },
  // Lock the Electron binary down: it cannot be run as plain Node, ignores
  // NODE_OPTIONS and --inspect, loads only the signed asar, and encrypts its cookies.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
    resetAdHocDarwinSignature: true,
  },
  mac: {
    category: "public.app-category.business",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      // The zip is what electron-updater installs from on macOS.
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    // No spaces: the update feed names the zip by this.
    artifactName: "O2-BOM-${version}-${arch}-mac.${ext}",
    hardenedRuntime: true,
    notarize,
  },
  dmg: { artifactName: "O2-BOM-${version}-${arch}.${ext}" },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    ...(azureSign ? { azureSignOptions: azureSign } : {}),
  },
  nsis: {
    artifactName: "O2-BOM-Setup-${version}.${ext}",
    oneClick: true,
    perMachine: false,
  },
  linux: {
    target: ["AppImage"],
    category: "Office",
    artifactName: "O2-BOM-${version}.${ext}",
  },
  // Installed apps read releases (tag v<version>) from this public
  // repository; the BOM repository is private.
  publish: updateUrl
    ? [{ provider: "generic", url: updateUrl }]
    : [{ provider: "github", owner: "O2TechAI", repo: "bom-desktop-releases", releaseType: "release" }],
};
