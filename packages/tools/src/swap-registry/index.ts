// The swap registry: art key → final render when one is dropped in, otherwise the placeholder.
// See ../placeholder-art/README.md.
export { ArtError, FINAL_EXTENSIONS, REGISTRY_FILE, placeholderPath, resolveArt, resolveRegistry } from './registry.ts';
export type { ArtEntry, ArtRegistry, RegistryInput, RegistryResult, UnusedFinal } from './registry.ts';
export { buildRegistry, listFiles, registryJson, writeRegistry } from './disk.ts';
export type { RegistryFolders } from './disk.ts';
