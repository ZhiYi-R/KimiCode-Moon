/**
 * Preload bridge.
 *
 * The web UI does not consume any preload API today (desktop mode is detected
 * purely from the URL query string), so this exposes a minimal, stable surface
 * for future shell↔renderer features (window controls, external links, deep
 * links). Kept deliberately small; sandboxed preloads cannot use Node APIs
 * beyond the Electron bridge subset (no fs, no process.env).
 */

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('kimiDesktop', {
  platform: process.platform,
});
