import { describe, expect, it } from 'vitest';

import { buildHelpDocInventory, createCanonicalHelpDocCatalog } from './help-docs.ts';

const EXPECTED_CANONICAL_MISSING_HELP_IDS = [
  'Head.MicropolisMenu',
  'Head.DisastersMenu',
  'Head.PriorityMenu',
  'Head.Date',
  'Head.Graph',
  'Head.Log',
  'Head.Chat',
  'Notice.Title',
  'Notice.Dismiss',
  'Help.Title',
  'Help.Text',
  'Frob.Title',
  'Frob.PopulationDensity',
  'Frob.RateOfGrowth',
  'Frob.TrafficDensity',
  'Frob.PollutionRate',
  'Frob.CrimeRate',
  'Frob.LandValue',
  'Frob.PoliceEffect',
  'Frob.FireEffect',
  'Scenario.NewCity',
  'Scenario.Dullsville',
  'Scenario.Hamburg',
  'Scenario.Tokyo',
  'Scenario.Boston',
  'Scenario.Previous',
  'Scenario.Next',
  'Scenario.Level',
  'Map.View',
  'Map.Overlays',
  'Editor.Display',
  'Editor.Message',
  'Editor.ToolPallet',
  'Editor.ToolCost',
  'Editor.ToolCom',
  'Editor.ToolFire',
  'Editor.ToolPolice',
  'Editor.ToolBulldozer',
  'Editor.ToolRoad',
  'Editor.ToolEraser',
  'Editor.ToolPark',
  'Editor.ToolCoal',
  'Editor.ToolAirport',
  'Editor.ZonePie',
  'Budget.Label',
  'Budget.Flow',
  'Budget.Current',
  'Budget.Fire',
  'Budget.Tax',
  'Budget.Reset',
  'Budget.AutoCancel',
  'Graph.10Years',
  'Graph.Res',
  'Graph.Ind',
  'Graph.Crime',
  'Graph.View',
  'Evaluation.Opinion',
  'Evaluation.WorstProblems',
  'Evaluation.Score',
  'Player.Players',
  'Player.Dismiss',
  'File.List',
  'File.File',
  'File.Rescan',
] as const;

const EXPECTED_CANONICAL_EXTRA_MANUAL_IDS = [
  'bibliography',
  'credits',
  'history',
  'index',
  'inside',
  'intro',
  'reference',
  'tutorial',
] as const;

describe('help docs parity', () => {
  it('keeps canonical missing/extra help-doc sets deterministic', () => {
    const catalog = createCanonicalHelpDocCatalog();

    // These fixed IDs come from canonical `Help <id>` declarations in
    // `ref/micropolis/res/help.tcl` compared against `ref/micropolis/manual/*.html`
    // files opened via `FormatHTML .../$id.html` in `ref/micropolis/res/micropolis.tcl`.
    expect(catalog.missing).toEqual(EXPECTED_CANONICAL_MISSING_HELP_IDS);
    expect(catalog.extra).toEqual(EXPECTED_CANONICAL_EXTRA_MANUAL_IDS);
  });

  it('preserves deterministic missing order and ASCII-sorted extra order', () => {
    const inventory = buildHelpDocInventory(
      ['Window', 'Notice', 'Window', 'Plan.Support'],
      ['tutorial', 'Notice', 'bibliography', 'tutorial'],
    );

    expect(inventory.missing).toEqual(['Window', 'Plan.Support']);
    expect(inventory.extra).toEqual(['bibliography', 'tutorial']);
  });
});
