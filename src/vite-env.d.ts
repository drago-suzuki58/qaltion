/// <reference types="vite/client" />

declare module "/wasm/qaltion.js" {
  const createModule: (options?: Record<string, unknown>) => Promise<unknown>;
  export default createModule;
}
