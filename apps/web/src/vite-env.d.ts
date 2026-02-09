/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORE_HOST_MODE?: 'local' | 'do';
  readonly VITE_STAGE4_AUTHORITY_MODE?: 'sim-core' | 'deterministic';
  readonly VITE_STAGE4_REAL_AUTHORITY?: '1' | '0' | 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
