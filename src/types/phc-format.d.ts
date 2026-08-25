declare module '@phc/format' {
  export interface PhcObject {
    id: string;
    version?: number;
    params?: Record<string, string | number>;
    salt?: Buffer;
    hash?: Buffer;
  }
  export function serialize(opts: PhcObject): string;
  export function deserialize(phcstr: string): PhcObject;
}
