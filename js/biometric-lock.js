/**
 * biometric-lock.js
 * ---------------------------------------------------------------------------
 * "Quick unlock" via Face ID / Touch ID / Android fingerprint, using the
 * device's own WebAuthn platform authenticator.
 *
 * IMPORTANT — what this is and isn't:
 *   This does NOT replace signing in with email/mobile + password, and
 *   Supabase never sees or verifies anything here. The actual login is
 *   still the normal Supabase session (see auth-service.js). This module
 *   just adds a LOCAL gate in front of an already-valid session: once
 *   someone has enabled it on a device, opening the app (or coming back
 *   from the 30-minute idle timeout, see idle-session.js) shows a
 *   biometric prompt before the app content renders, instead of silently
 *   resuming. If the prompt fails or the person taps "Use password
 *   instead", they fall back to a normal sign-in.
 *
 *   The credential this creates never leaves the device and isn't sent
 *   anywhere — WebAuthn's platform authenticator itself (backed by Face
 *   ID / Touch ID / Android's biometric hardware) is what refuses to
 *   produce a valid response for anyone but the enrolled person, so it's
 *   the OS/hardware doing the actual verification, not this code.
 *
 * Storage is deliberately per-device (localStorage, not synced) — enabling
 * this on your phone shouldn't require or affect your laptop.
 */

const BiometricLock = (() => {
  const CREDENTIAL_ID_KEY = 'pj_biometric_credential_id';
  const RP_NAME = 'Transform';

  function bufToBase64Url(buf) {
    const bytes = new Uint8Array(buf);
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBuf(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + (4 - b64url.length % 4) % 4, '=');
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes.buffer;
  }

  /** Whether this device/browser can even do platform biometric auth at
   *  all — false on most desktops without Face ID / Windows Hello / a
   *  fingerprint reader, and on browsers without WebAuthn support. Always
   *  check this before showing any biometric UI. */
  async function isSupported() {
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /** Whether quick unlock has already been set up on THIS device. */
  function isEnabled() {
    return !!localStorage.getItem(CREDENTIAL_ID_KEY);
  }

  /** Registers a new platform authenticator credential, triggering the
   *  actual Face ID / fingerprint prompt. Returns { ok: true } on success,
   *  or { ok: false, reason } — reason is 'cancelled' if the person backed
   *  out of the prompt, or 'error' for anything else (unsupported browser,
   *  hardware issue, etc). */
  async function enable(accountLabel) {
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: RP_NAME },
          user: {
            id: userId,
            name: accountLabel || 'Transform user',
            displayName: accountLabel || 'Transform user',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 60000,
        },
      });

      if (!credential) return { ok: false, reason: 'error' };
      localStorage.setItem(CREDENTIAL_ID_KEY, bufToBase64Url(credential.rawId));
      return { ok: true };
    } catch (err) {
      const cancelled = err?.name === 'NotAllowedError';
      console.error('BiometricLock.enable failed', err);
      return { ok: false, reason: cancelled ? 'cancelled' : 'error' };
    }
  }

  /** Removes the local credential — quick unlock reverts to a normal
   *  password sign-in on this device from now on. */
  function disable() {
    localStorage.removeItem(CREDENTIAL_ID_KEY);
  }

  /** Prompts Face ID / fingerprint and resolves true only if it succeeds
   *  against the SAME credential that was registered on this device.
   *  Resolves false (never throws) on cancellation, failure, or if
   *  quick unlock isn't enabled at all. */
  async function verify() {
    const storedId = localStorage.getItem(CREDENTIAL_ID_KEY);
    if (!storedId) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: base64UrlToBuf(storedId), type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      return !!assertion;
    } catch (err) {
      console.error('BiometricLock.verify failed', err);
      return false;
    }
  }

  return { isSupported, isEnabled, enable, disable, verify };
})();
