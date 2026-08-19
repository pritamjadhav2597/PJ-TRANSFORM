/**
 * device-integration.js
 * ---------------------------------------------------------------------------
 * Prepares the architecture for future step-tracking device integration
 * (a fitness band, phone pedometer API, Google Fit, Apple Health, ...)
 * without implementing any real device connection yet — there is no device
 * API available in this environment. Today only the 'manual' provider is
 * active; StepEntry records already carry a `source` field (see
 * Models.createStepEntry) so a future device provider slots in with no
 * change to the data shape or to how the Steps page reads/displays entries.
 *
 * To add a real device later: implement `fetchStepsForDate(date)` on a new
 * provider object (returning a Promise<number|null>), register it in
 * PROVIDERS, and the Steps page's provider selector will pick it up —
 * nothing else in the app needs to change.
 * ---------------------------------------------------------------------------
 */

const DeviceIntegration = (() => {

  const PROVIDERS = {
    manual: {
      key: 'manual',
      label: 'Manual entry',
      isDevice: false,
      available: true,
    },
    // Example shape a future device provider must satisfy — inactive until
    // a real integration exists. Kept here so the intended contract is
    // documented in code, not just in a comment elsewhere.
    device_placeholder: {
      key: 'device_placeholder',
      label: 'Connect a device (coming soon)',
      isDevice: true,
      available: false,
      // fetchStepsForDate: async (date) => null,
    },
  };

  function listProviders() {
    return Object.values(PROVIDERS);
  }

  function getProvider(key) {
    return PROVIDERS[key] || PROVIDERS.manual;
  }

  function isDeviceProvider(key) {
    return !!getProvider(key).isDevice;
  }

  /** Always resolves — returns null for any provider without a real
   *  fetchStepsForDate implementation (i.e. everything today). Pages call
   *  this instead of touching PROVIDERS directly so the "no device yet"
   *  behavior lives in exactly one place. */
  async function fetchStepsForDate(providerKey, date) {
    const provider = getProvider(providerKey);
    if (!provider.available || typeof provider.fetchStepsForDate !== 'function') return null;
    return provider.fetchStepsForDate(date);
  }

  return { PROVIDERS, listProviders, getProvider, isDeviceProvider, fetchStepsForDate };
})();
