import type { Export } from '../../types/module-graph.ts';

export const liveContainingExports = (
  exports: Map<string, Export>,
  isEligible: (item: Export) => boolean,
  isReferenced: (identifier: string, item: Export) => boolean
) => {
  const dependents = new Map<string, Set<string>>();
  for (const [identifier, item] of exports) {
    if (!item.referencedIn) continue;
    for (const container of item.referencedIn) {
      const parent = exports.get(container);
      if (!parent || !isEligible(parent)) continue;
      let children = dependents.get(container);
      if (!children) dependents.set(container, (children = new Set()));
      children.add(identifier);
    }
  }
  const live = new Set<string>();
  for (const [container, children] of dependents) {
    const item = exports.get(container);
    if (item && isReferenced(container, item)) for (const child of children) live.add(child);
  }
  for (const container of live) {
    const children = dependents.get(container);
    if (children) for (const child of children) live.add(child);
  }
  return live;
};
