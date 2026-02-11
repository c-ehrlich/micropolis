import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

export const Route = createRootRoute({
  component: RootLayout,
});

const SHOW_DEVTOOLS = false;

function RootLayout() {
  return (
    <>
      <Outlet />
      {SHOW_DEVTOOLS ? <TanStackRouterDevtools position="bottom-right" /> : null}
    </>
  );
}
