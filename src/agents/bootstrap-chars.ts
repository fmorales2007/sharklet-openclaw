// The one way a workspace file is measured against the bootstrap limits. Pure and
// import-free so the Control UI can show the same number the runtime truncates by.
export function bootstrapContentChars(content: string): number {
  return content.trimEnd().length;
}
