export type ConfidenceBand = 'low' | 'moderate' | 'high';

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.75) return 'high';
  if (score >= 0.50) return 'moderate';
  return 'low';
}

export function confidenceLabel(score: number): string {
  const band = confidenceBand(score);
  return band[0].toUpperCase() + band.slice(1);
}

export function confidenceClasses(score: number): string {
  const band = confidenceBand(score);
  if (band === 'high') return 'bg-green-100 text-green-800 border-green-200';
  if (band === 'moderate') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-red-100 text-red-800 border-red-200';
}

export function confidenceBarClass(score: number): string {
  const band = confidenceBand(score);
  if (band === 'high') return 'bg-green-500';
  if (band === 'moderate') return 'bg-amber-500';
  return 'bg-red-500';
}
