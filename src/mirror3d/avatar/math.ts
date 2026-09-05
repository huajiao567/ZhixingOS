export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * clamp(t);

export const inverseLerp = (min: number, max: number, value: number): number => {
  if (Math.abs(max - min) < 1e-9) return 0.5;
  return clamp((value - min) / (max - min));
};

export const ratioToBaseline = (value: number, baseline: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) return 1;
  return clamp(value / baseline, 0, 2);
};

export const exponentialSmooth = (previous: number, next: number, alpha = 0.28): number =>
  lerp(previous, next, alpha);

export const round = (value: number, digits = 2): number => {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
};
