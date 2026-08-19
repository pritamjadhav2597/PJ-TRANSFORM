/**
 * step-counter.js
 * ---------------------------------------------------------------------------
 * A lightweight, in-browser pedometer using the phone's built-in
 * accelerometer via the DeviceMotion API. Counts steps live while this tab
 * is open and in the foreground (screen on, app on-screen) — that's a real
 * platform limitation, not a bug: browsers throttle/suspend sensor events
 * once a tab is hidden or the screen locks, and there is no web API for
 * true background step tracking (see js/device-integration.js for why a
 * cloud-connected device/Health-platform integration isn't available
 * either).
 *
 * Algorithm: a simple peak-detection pedometer. Tracks the magnitude of
 * the combined acceleration vector, smooths it with a slow-adapting
 * low-pass filter to approximate the person's current baseline (gravity +
 * whatever steady state they're in), and counts a step whenever the raw
 * magnitude spikes meaningfully above that baseline, with a minimum gap
 * between counted steps so a single footfall isn't counted twice. This is
 * an estimate — like most phone pedometers, not lab-grade — and accuracy
 * varies by phone position (hand vs. pocket) and gait.
 * ---------------------------------------------------------------------------
 */

const StepCounter = (() => {

  const MIN_STEP_INTERVAL_MS = 300;   // fastest plausible real steps are ~2-3/sec
  const SPIKE_THRESHOLD = 1.15;       // m/s² above the adaptive baseline to count as a step
  const BASELINE_SMOOTHING = 0.9;     // higher = baseline adapts more slowly (steadier)

  let active = false;
  let smoothedMag = null;
  let lastStepAt = 0;
  let onStepCallback = null;

  function isSupported() {
    return typeof window !== 'undefined' && typeof DeviceMotionEvent !== 'undefined';
  }

  /** iOS 13+ requires an explicit, user-gesture-triggered permission
   *  prompt before motion events fire at all. Most Android/desktop
   *  browsers don't define this method — nothing to ask there. */
  function needsPermission() {
    return isSupported() && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  async function requestPermission() {
    if (!needsPermission()) return true;
    try {
      const result = await DeviceMotionEvent.requestPermission();
      return result === 'granted';
    } catch (err) {
      console.error('Motion permission request failed', err);
      return false;
    }
  }

  function handleMotion(e) {
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc || acc.x == null || acc.y == null || acc.z == null) return;

    const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
    smoothedMag = smoothedMag == null ? mag : (smoothedMag * BASELINE_SMOOTHING) + (mag * (1 - BASELINE_SMOOTHING));

    const spike = mag - smoothedMag;
    const now = Date.now();
    if (spike > SPIKE_THRESHOLD && (now - lastStepAt) > MIN_STEP_INTERVAL_MS) {
      lastStepAt = now;
      if (onStepCallback) onStepCallback();
    }
  }

  /** Starts counting. `onStep` is called once per detected step. Returns
   *  false if the platform has no motion API at all (nothing to start). */
  function start(onStep) {
    if (active) return true;
    if (!isSupported()) return false;
    onStepCallback = onStep;
    smoothedMag = null;
    lastStepAt = 0;
    window.addEventListener('devicemotion', handleMotion);
    active = true;
    return true;
  }

  function stop() {
    if (active) window.removeEventListener('devicemotion', handleMotion);
    active = false;
    onStepCallback = null;
  }

  function isActive() { return active; }

  return { isSupported, needsPermission, requestPermission, start, stop, isActive };
})();
