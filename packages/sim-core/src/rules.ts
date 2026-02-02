export interface Ruleset {
  name: string;
  quirks: {
    powerPlantConnectivityBug: boolean;
    seaportDoesNotNeedWater: boolean;
  };
}

export const CLASSIC_RULESET: Ruleset = {
  name: 'classic',
  quirks: {
    powerPlantConnectivityBug: true,
    seaportDoesNotNeedWater: true,
  },
};
