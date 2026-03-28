/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GTM_ID?: string;
  readonly VITE_META_PIXEL_ID?: string;
  /** Google Ads conversion ID (AW-xxxxxxx) for optional gtag + conversion linker after ads consent */
  readonly VITE_GOOGLE_ADS_ID?: string;
  /** POST endpoint URL for JSON web-vitals payloads (LCP, CLS, INP); optional */
  readonly VITE_WEB_VITALS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
