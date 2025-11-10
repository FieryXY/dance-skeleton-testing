import { useEffect, useState } from "react";

export const CALIBRATION_STORAGE_KEY = "dance_skeleton:calibrationMs";

export function saveCalibrationMs(ms: number | null) {
  try {
    if (ms == null) {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    } else {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, String(ms));
    }
  } catch (e) {
    // localStorage may throw on some browsers/environments; fail silently
    console.warn("Failed to save calibration to localStorage:", e);
  }
}

export function loadCalibrationMs(): number | null {
  try {
    const v = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    console.warn("Failed to read calibration from localStorage:", e);
    return null;
  }
}

// React hook for convenience in components
export function useCalibration(): [number | null, (ms: number | null) => void] {
  const [calibration, setCalibration] = useState<number | null>(() => loadCalibrationMs());

  useEffect(() => {
    try {
      if (calibration == null) localStorage.removeItem(CALIBRATION_STORAGE_KEY);
      else localStorage.setItem(CALIBRATION_STORAGE_KEY, String(calibration));
    } catch (e) {
      console.warn("Failed to persist calibration:", e);
    }
  }, [calibration]);

  return [calibration, setCalibration];
}
