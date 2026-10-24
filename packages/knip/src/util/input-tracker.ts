import { AsyncLocalStorage } from 'node:async_hooks';
import { fileFingerprint } from './file-fingerprint.ts';
import { resolveCwd } from './path.ts';

const inputs = new AsyncLocalStorage<Map<string, string | undefined>>();

export const withInputTracking = <T>(reads: Map<string, string | undefined>, load: () => T): T =>
  inputs.run(reads, load);

export const getInputTracker = () => {
  const reads = inputs.getStore();
  if (reads)
    return (filePath: string) => {
      const path = resolveCwd(filePath);
      if (!reads.has(path)) reads.set(path, fileFingerprint(path));
    };
};
