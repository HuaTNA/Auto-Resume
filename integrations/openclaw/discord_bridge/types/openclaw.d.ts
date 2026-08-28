declare module "typebox" {
  export const Type: any;
}

declare module "openclaw/plugin-sdk/tool-plugin" {
  export function defineToolPlugin(definition: any): any;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(value: string): { digest(encoding: "hex"): string };
  };
}
