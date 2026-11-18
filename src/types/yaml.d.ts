declare module "*.yaml" {
  const content: string;
  export default content;
}

declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
    nocase?: boolean;
  }
  const picomatch: {
    isMatch(input: string, pattern: string, options?: PicomatchOptions): boolean;
  };
  export default picomatch;
}
