export interface SimClocks {
  simStep: number;
  simWeeks: number;
  realtimeTick: number;
}

export function createClocks(): SimClocks {
  return {
    simStep: 0,
    simWeeks: 0,
    realtimeTick: 0,
  };
}

export function advanceSimStep(clocks: SimClocks): void {
  const nextStep = (clocks.simStep + 1) & 15;
  clocks.simStep = nextStep;
  if (nextStep === 0) {
    clocks.simWeeks += 1;
  }
}

export function advanceRealtimeTicks(clocks: SimClocks, ticks: number): void {
  clocks.realtimeTick += ticks;
}
