import { createFileRoute } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';

import { describeRuntimeStatus } from '../game/runtime';
import { gameRuntime } from '../game/runtime-instance';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const state = useSyncExternalStore(
    (onStoreChange) => gameRuntime.subscribeState(() => onStoreChange()),
    () => gameRuntime.getState(),
    () => gameRuntime.getState(),
  );
  const status = describeRuntimeStatus(state);

  return (
    <main>
      <h1>City Runtime</h1>
      <p>{status.headline}</p>
      <p>{status.detail}</p>
    </main>
  );
}
