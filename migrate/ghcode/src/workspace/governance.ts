/** Files emitted by the template's governed Markdown generator, never independent sources. */
const GENERATED_DOCUMENTS = new Set([
  ".agents/README.md",
  ".agents/PRD.md",
  ".agents/ARCHITECTURE.md",
  ".agents/AGENTS.md",
]);

export function isGeneratedDocument(path: string): boolean {
  return GENERATED_DOCUMENTS.has(path.replace(/\\/g, "/").replace(/^\.\//, ""));
}

export function canonicalSourceDirectory(path: string): string | null {
  switch (path.replace(/\\/g, "/").replace(/^\.\//, "")) {
    case ".agents/README.md":
      return ".agents/notes/";
    case ".agents/PRD.md":
      return ".agents/requests/";
    case ".agents/ARCHITECTURE.md":
      return ".agents/decisions/";
    case ".agents/AGENTS.md":
      return ".agents/rules/";
    default:
      return null;
  }
}
