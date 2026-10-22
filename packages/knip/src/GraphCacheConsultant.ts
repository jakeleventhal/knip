import { deserialize, serialize } from 'node:v8';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import type { FileNode } from './types/module-graph.ts';
import type { ResolveModule, ResolvedModule } from './typescript/ast-nodes.ts';
import type { MainOptions } from './util/create-options.ts';
import { FileEntryCache } from './util/file-entry-cache.ts';
import { version } from './version.ts';

type Analysis = { file: FileNode; resolutions: Map<string, ResolvedModule | undefined> };

export class GraphCacheConsultant {
  private cache: FileEntryCache<Uint8Array> | undefined;

  private options: MainOptions;

  constructor(options: MainOptions) {
    this.options = options;
  }

  init(context: string) {
    if (!this.options.isCache) return;
    this.cache = new FileEntryCache(
      `analysis-js-${version}`,
      this.options.cacheLocation,
      serialize,
      true,
      createHash('sha256').update(context).digest('hex')
    );
  }

  get enabled() {
    return this.cache !== undefined;
  }

  getCachedFile(filePath: string, skipExports: boolean, resolve: ResolveModule): FileNode | undefined {
    const descriptor = this.cache?.getFileDescriptor(filePath);
    const bytes = !descriptor?.changed && descriptor?.meta?.data;
    if (!bytes) return;
    try {
      const analysis: Analysis = deserialize(bytes);
      for (const [specifier, previous] of analysis.resolutions) {
        if (!isDeepStrictEqual(resolve(specifier, filePath), previous)) return;
      }
      return analysis.file.skipExports === skipExports ? analysis.file : undefined;
    } catch {
      this.removeEntry(filePath);
    }
  }

  setCachedFile(filePath: string, file: FileNode, resolutions: Analysis['resolutions']) {
    if (!this.cache) return;
    this.cache.setFileData(filePath, serialize({ file, resolutions }));
  }

  removeEntry(filePath: string) {
    this.cache?.removeEntry(filePath);
  }

  reconcile() {
    this.cache?.reconcile();
    if (!this.options.isSession && !this.options.isWatch) this.cache = undefined;
  }
}
