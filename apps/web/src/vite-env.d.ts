/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORE_HOST_MODE?: 'local' | 'do';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
