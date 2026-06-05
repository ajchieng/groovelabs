/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUDIOTOOL_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
