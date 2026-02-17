import { createFileRoute } from '@tanstack/react-router';

import { useScenarioEditorState } from '../state/editor-state.tsx';
import { ScenarioBehaviorProfileEditorCard } from './-section-behavior.tsx';
import { ScenarioExportCard } from './-section-export.tsx';
import { ScenarioMapFinalWorkbench } from './-section-map.tsx';
import { ScenarioMetadataEditorCard } from './-section-metadata.tsx';
import { ScenarioObjectiveEditorCard } from './-section-objective.tsx';
import { ScenarioScriptEditorCard } from './-section-script.tsx';

export const Route = createFileRoute('/')({
  component: ScenarioEditorHomeRoute,
});

/**
 * Stage 4 workbench route with metadata/map editing plus objective and script authoring.
 * Parity note: objective metric leaves map to `DoScenarioScore` checks in
 * `ref/micropolis/src/sim/s_msg.c`, while logical composition forms are declarative
 * runtime extensions from `packages/scenario-runtime`; script events map to
 * `ScenarioDisaster` trigger/action domains in `ref/micropolis/src/sim/s_disast.c`; behavior
 * profile assignment maps closed `DoShipSprite` variants from `ref/micropolis/src/sim/w_sprite.c`.
 */
function ScenarioEditorHomeRoute() {
  const { activeView } = useScenarioEditorState();

  if (activeView === 'metadata') {
    return <ScenarioMetadataEditorCard />;
  }
  if (activeView === 'map-final') {
    return <ScenarioMapFinalWorkbench />;
  }
  if (activeView === 'objective') {
    return <ScenarioObjectiveEditorCard />;
  }
  if (activeView === 'script') {
    return <ScenarioScriptEditorCard />;
  }
  if (activeView === 'behavior') {
    return <ScenarioBehaviorProfileEditorCard />;
  }

  return <ScenarioExportCard />;
}
