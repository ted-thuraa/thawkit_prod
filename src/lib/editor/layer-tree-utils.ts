// path: src/lib/editor/layer-tree-utils.ts

import type { Layer, LayerInteraction } from "@/types/funnel";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Pure, framework-free layer-tree functions — ported from Ycode's
 * lib/layer-utils.ts (4,505 lines) and lib/utils.ts (github.com/ycode/ycode,
 * MIT licensed). Only the subset actually used by stores/use-pages-store.ts
 * is ported here, faithfully rather than reimplemented from scratch — tree
 * algorithms like "regenerate ids but keep interaction references pointing
 * at the right (new) sibling" have real correctness edge cases that are
 * easy to get subtly wrong if rewritten from a guess instead of the
 * working implementation.
 *
 * DELIBERATELY NOT PORTED from the same source file, with reasons:
 *   - Link-nesting validation (`layerHasLink`, `hasLinkInTree`, and the
 *     link-specific branches of `canAddChild`/`canPasteIntoParent`/
 *     `canMoveLayer`) — `layerHasLink`/`hasLinkInTree` live outside
 *     layer-utils.ts and weren't traced down for this pass. `canAddChild`
 *     below only implements the non-link rules (leaf element types,
 *     component-instance children, section-in-section). This means
 *     nesting an `<a>` inside another `<a>` isn't rejected yet — a real
 *     but narrow HTML-validity gap, not a core tree-editing gap.
 *   - CMS/collection-bound branches: `deleteLayer`'s pagination-wrapper
 *     handling, `moveLayer`'s `resetBindingsAfterMove`, `canHaveChildren`
 *     ignoring collection-driven child constraints. Consistent with
 *     CMS/Collections being excluded from this project entirely.
 *   - `addLayerFromTemplate`'s block-template system
 *     (`lib/templates/blocks`) — a starter-blocks library, not core tree
 *     mutation; nothing here prevents adding it later as its own module.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ─── ID generation ──────────────────────────────────────────────────────────

/**
 * Matches Ycode's `generateId()` exactly (lib/utils.ts) — a short,
 * collision-resistant-enough id for layer tree nodes. Deliberately NOT the
 * same id scheme as database primary keys elsewhere in this codebase
 * (nanoid/uuid): layer ids live inside a JSON column, never as a DB
 * primary key or foreign key target, so there's no reason to pull in an
 * extra dependency here when this generator is already proven to work at
 * the scale Ycode runs it at.
 */
export function generateLayerId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 36 ** 6).toString(36);
  const id = `${timestamp}${random}`;
  return prefix ? `${prefix}-${id}` : id;
}

// ─── Tree traversal ─────────────────────────────────────────────────────────

export function findLayerById(layers: Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.children) {
      const found = findLayerById(layer.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Walk up from `layerId` and return the first ancestor matching `predicate`, or null. Builds flat parent/id maps once rather than re-walking from the root for every ancestor check. */
export function findAncestor(
  layers: Layer[],
  layerId: string,
  predicate: (layer: Layer) => boolean,
): Layer | null {
  const layerMap = new Map<string, Layer>();
  const parentMap = new Map<string, string>();

  const buildMaps = (nodes: Layer[], parentId: string | null = null) => {
    for (const node of nodes) {
      layerMap.set(node.id, node);
      if (parentId) parentMap.set(node.id, parentId);
      if (node.children) buildMaps(node.children, node.id);
    }
  };
  buildMaps(layers);

  if (!layerMap.has(layerId)) return null;

  let parentId = parentMap.get(layerId);
  while (parentId) {
    const parent = layerMap.get(parentId);
    if (parent && predicate(parent)) return parent;
    parentId = parentMap.get(parentId);
  }
  return null;
}

export function findAncestorByName(
  layers: Layer[],
  layerId: string,
  ancestorName: string,
): Layer | null {
  return findAncestor(layers, layerId, (layer) => layer.name === ancestorName);
}

/** Update a single layer in a tree by id, returning a new tree (structural sharing elsewhere is not attempted — matches Ycode's own approach of always mapping the full tree). */
export function updateLayerInTree(
  layers: Layer[],
  targetId: string,
  updater: (layer: Layer) => Layer,
): Layer[] {
  return layers.map((node) => {
    if (node.id === targetId) return updater(node);
    if (node.children) {
      return {
        ...node,
        children: updateLayerInTree(node.children, targetId, updater),
      };
    }
    return node;
  });
}

export function removeLayerById(layers: Layer[], id: string): Layer[] {
  return layers
    .filter((layer) => layer.id !== id)
    .map((layer) =>
      layer.children
        ? { ...layer, children: removeLayerById(layer.children, id) }
        : layer,
    );
}

// ─── Placement rules ────────────────────────────────────────────────────────

const LEAF_LAYER_NAMES = [
  "icon",
  "image",
  "audio",
  "video",
  "iframe",
  "heading",
  "text",
  "richText",
  "span",
  "label",
  "hr",
  "input",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "htmlEmbed",
];

/**
 * Can this layer have children added to it, given the type of child (if
 * known)? Ported minus the link-nesting and CMS/collection branches — see
 * file header.
 */
export function canHaveChildren(
  layer: Layer,
  childLayerType?: string,
): boolean {
  // Component instances cannot have children added directly — children can
  // only be edited in the master component.
  if (layer.componentId) return false;

  if (layer.name === "section" && childLayerType === "section") return false;

  return !LEAF_LAYER_NAMES.includes(layer.name ?? "");
}

/** Ported minus the link-nesting branches — see file header. */
export function canAddChild(parent: Layer, child: Layer): boolean {
  return canHaveChildren(parent, child.name);
}

/** Ported minus the link-nesting branch — see file header. */
export function canPasteIntoParent(
  layers: Layer[],
  parentId: string,
  childToPaste: Layer,
): boolean {
  const parent = findLayerById(layers, parentId);
  if (!parent) return true;
  return canAddChild(parent, childToPaste);
}

/**
 * Can `layerId` move to become a child of `newParentId` (null = root)?
 * Ported faithfully for the `restrictions.ancestor` check (a layer that
 * must always live somewhere inside a named ancestor, e.g. a dropdown item
 * that must stay inside its dropdown) — minus the link-nesting branch, see
 * file header.
 */
export function canMoveLayer(
  layers: Layer[],
  layerId: string,
  newParentId: string | null,
): boolean {
  const layer = findLayerById(layers, layerId);
  if (!layer) return false;

  if (newParentId !== null) {
    const newParent = findLayerById(layers, newParentId);
    if (newParent && !canAddChild(newParent, layer)) return false;
  }

  if (!layer.restrictions?.ancestor) return true;

  const requiredAncestor = layer.restrictions.ancestor;
  const currentAncestor = findAncestorByName(layers, layerId, requiredAncestor);

  if (newParentId === null) {
    // Can only move to root if no ancestor was required in the first place.
    return !currentAncestor;
  }

  const newParent = findLayerById(layers, newParentId);
  if (!newParent) return false;

  if (newParent.name === requiredAncestor) return true;

  const newParentAncestor = findAncestorByName(
    layers,
    newParentId,
    requiredAncestor,
  );
  return currentAncestor?.id === newParentAncestor?.id;
}

// ─── Duplication / paste ────────────────────────────────────────────────────

function regenerateInteractionIds(
  interactions: LayerInteraction[],
  idMap: Map<string, string>,
): LayerInteraction[] {
  return interactions.map((interaction) => ({
    ...interaction,
    id: generateLayerId("int"),
    tweens: interaction.tweens.map((tween) => ({
      ...tween,
      id: generateLayerId("twn"),
      // Remap to the duplicated copy of the target layer when the tween's
      // target was inside the duplicated subtree (idMap has it); otherwise
      // leave it pointing at the original external layer, which is still
      // correct — the tween wasn't duplicated, so its target shouldn't move.
      layer_id: idMap.get(tween.layer_id) ?? tween.layer_id,
    })),
  }));
}

/**
 * Deep-clones a layer subtree with every layer id regenerated, and
 * remaps any interaction tween `layer_id` references that pointed at a
 * layer inside the duplicated subtree to the new, regenerated id — so a
 * duplicated layer's "on click, animate my sibling" interaction animates
 * the *new* sibling, not the original one. Ported faithfully; this is
 * exactly the kind of correctness detail worth not re-deriving from
 * scratch (see file header).
 */
export function regenerateIdsWithInteractionRemapping(layer: Layer): Layer {
  const idMap = new Map<string, string>();

  const generateNewIds = (l: Layer): Layer => {
    const newId = generateLayerId("lyr");
    idMap.set(l.id, newId);
    return { ...l, id: newId, children: l.children?.map(generateNewIds) };
  };
  const layerWithNewIds = generateNewIds(layer);

  const remapInteractions = (l: Layer): Layer => {
    let updated = l;
    if (l.interactions && l.interactions.length > 0) {
      updated = {
        ...updated,
        interactions: regenerateInteractionIds(l.interactions, idMap),
      };
    }
    if (updated.children) {
      updated = {
        ...updated,
        children: updated.children.map(remapInteractions),
      };
    }
    return updated;
  };

  return remapInteractions(layerWithNewIds);
}

interface ParentAndIndex {
  parent: Layer | null;
  index: number;
}

/** Find a layer's direct parent (null = root) and its index among its siblings. */
export function findParentAndIndex(
  layers: Layer[],
  targetId: string,
  parent: Layer | null = null,
): ParentAndIndex | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer.id === targetId) return { parent, index: i };
    if (layer.children && layer.children.length > 0) {
      const found = findParentAndIndex(layer.children, targetId, layer);
      if (found) return found;
    }
  }
  return null;
}

/** Insert `newLayer` immediately after `parent`'s child at `insertIndex` (or at root level when `parent` is null). */
export function insertLayerAfter(
  layers: Layer[],
  parent: Layer | null,
  insertIndex: number,
  newLayer: Layer,
): Layer[] {
  if (parent === null) {
    const next = [...layers];
    next.splice(insertIndex + 1, 0, newLayer);
    return next;
  }
  return layers.map((layer) => {
    if (layer.id === parent.id) {
      const children = [...(layer.children || [])];
      children.splice(insertIndex + 1, 0, newLayer);
      return { ...layer, children };
    }
    if (layer.children && layer.children.length > 0) {
      return {
        ...layer,
        children: insertLayerAfter(
          layer.children,
          parent,
          insertIndex,
          newLayer,
        ),
      };
    }
    return layer;
  });
}

/** Insert `newLayer` at a specific index within `parentId`'s children (or at root when `parentId` is null). */
export function insertLayerAt(
  layers: Layer[],
  parentId: string | null,
  index: number,
  newLayer: Layer,
): Layer[] {
  if (parentId === null) {
    const next = [...layers];
    next.splice(index, 0, newLayer);
    return next;
  }
  return layers.map((node) => {
    if (node.id === parentId) {
      const children = [...(node.children || [])];
      children.splice(index, 0, newLayer);
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: insertLayerAt(node.children, parentId, index, newLayer),
      };
    }
    return node;
  });
}

/** Is `childId` a descendant of `parentId` within `layers`? Used to reject circular moves (dragging a layer into its own subtree). */
export function isDescendant(
  layers: Layer[],
  parentId: string,
  childId: string,
): boolean {
  const parent = findLayerById(layers, parentId);
  if (!parent || !parent.children) return false;
  for (const child of parent.children) {
    if (child.id === childId) return true;
    if (child.children && isDescendant(layers, child.id, childId)) return true;
  }
  return false;
}
