// lib/platform.js
//
// Where is this running?

/**
 * Running inside the Capacitor native shell?
 *
 * Deliberately not re-exported from lib/native-auth — that module pulls in
 * firebase/auth. Same check, same answer, no dependency.
 */
export function isNativePlatform() {
  try {
    const { Capacitor } = require('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
