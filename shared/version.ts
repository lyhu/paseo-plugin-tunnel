// Paseo 0.8 rejects a plugin whose bundle resolves any module at the plugin
// root, so the client cannot import `package.json`. The version is mirrored
// here and guarded against drift by `version.test.ts`.
export const PLUGIN_VERSION = "0.3.1";
