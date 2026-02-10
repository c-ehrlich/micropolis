/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORE_HOST_MODE?: 'local' | 'do';
  readonly VITE_REAL_AUTHORITY?: '1' | '0' | 'true' | 'false';
  readonly VITE_DEBUG_TILE_RENDERER?: '1' | '0' | 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
