export type LoadingDemoScenario = 'open' | 'preferences' | 'location' | 'slow' | 'error' | 'empty' | 'instant';
export type LoadingDemoPhase = 'warmup' | 'locating' | 'searching' | 'slow' | 'ready' | 'error' | 'empty';
export const loadingDemoScenarios: {id: LoadingDemoScenario; label: string}[] = [
  {id: 'open', label: 'App open'}, {id: 'preferences', label: 'Preferences'},
  {id: 'location', label: 'Location'}, {id: 'slow', label: 'Slow'},
  {id: 'error', label: 'Error'}, {id: 'empty', label: 'Empty'}, {id: 'instant', label: 'Instant'},
];

/** Simulation timings only. No real discovery or location request uses this plan. */
export function loadingDemoPlan(scenario: LoadingDemoScenario, retry = false): {at: number; phase: LoadingDemoPhase}[] {
  if (scenario === 'instant') return [{at: 0, phase: 'ready'}];
  if (scenario === 'location') return [
    {at: 0, phase: 'warmup'}, {at: 600, phase: 'locating'},
    {at: 2200, phase: 'searching'}, {at: 4800, phase: 'ready'},
  ];
  if (scenario === 'slow') return [
    {at: 0, phase: 'warmup'}, {at: 600, phase: 'searching'},
    {at: 8000, phase: 'slow'}, {at: 12000, phase: 'ready'},
  ];
  return [
    {at: 0, phase: 'warmup'}, {at: 600, phase: 'searching'},
    {at: scenario === 'error' && !retry || scenario === 'empty' ? 2200 : 3500,
      phase: scenario === 'error' && !retry ? 'error' : scenario === 'empty' ? 'empty' : 'ready'},
  ];
}

export function loadingDemoMessage(scenario: LoadingDemoScenario, phase: LoadingDemoPhase) {
  if (phase === 'slow') return {title: 'Finding people for you…', detail: 'This is taking longer than usual.'};
  if (scenario === 'location') return phase === 'warmup' || phase === 'locating'
    ? {title: 'Getting your location…', detail: 'Preparing your nearby profiles.'}
    : {title: 'Finding people nearby…', detail: 'Using your updated location.'};
  if (scenario === 'preferences') return {title: 'Updating your picks…', detail: 'Using your latest preferences.'};
  return {title: 'Finding people for you…', detail: 'Based on your preferences.'};
}
