import { Container } from 'augmenta-client-sdk';

export function createSetupStore() {
  let root;
  let scenes = [];

  function refreshScenes() {
    scenes = [];
    collectScenes(root, scenes);
  }

  function setRoot(nextRoot) {
    root = nextRoot;
    refreshScenes();
    return root;
  }

  function applyUpdate(update) {
    if (!update) return root;
    if (!root) return setRoot(update);

    const merged = replaceInTree(root, update);
    root = merged.changed ? merged.node : insertAtBestParent(root, update);
    refreshScenes();
    return root;
  }

  function clear() {
    root = undefined;
    scenes = [];
  }

  return {
    clear,
    setRoot,
    applyUpdate,
    getRoot: () => root,
    getScenes: () => scenes
  };
}

function collectScenes(container, output) {
  if (!container) return;
  if (container.isScene?.()) output.push(container);
  for (const child of container.getChildren?.() ?? []) collectScenes(child, output);
}

function replaceInTree(current, update) {
  if (sameContainer(current, update)) {
    return { node: mergeContainer(current, update), changed: true };
  }

  let changed = false;
  const children = current.getChildren().map((child) => {
    const result = replaceInTree(child, update);
    changed ||= result.changed;
    return result.node;
  });

  return {
    node: changed ? cloneContainer(current, children) : current,
    changed
  };
}

function mergeContainer(previous, update) {
  let children = [...previous.getChildren()];

  for (const updateChild of update.getChildren()) {
    const index = children.findIndex((child) => sameContainer(child, updateChild));
    if (index < 0) {
      children.push(updateChild);
    } else {
      children[index] = mergeContainer(children[index], updateChild);
    }
  }

  // Pleiades update messages normally describe only the changed container.
  // Preserve its existing subtree when the update omits children.
  return cloneContainer(update, children);
}

function insertAtBestParent(root, update) {
  const updateAddress = update.getAddress();
  if (!updateAddress) return root;

  const parent = deepestAddressPrefix(root, updateAddress);
  if (parent) {
    return appendChild(root, parent.getAddress(), update).node;
  }

  // A new top-level Scene can legitimately arrive below a World whose own
  // address is omitted from setup JSON.
  if (root.isWorld?.() && update.isScene?.()) {
    return cloneContainer(root, [...root.getChildren(), update]);
  }

  return root;
}

function deepestAddressPrefix(root, childAddress) {
  let best;
  let bestLength = -1;

  function visit(container) {
    const address = container.getAddress();
    if (
      address
      && childAddress.startsWith(`${address}/`)
      && address.length > bestLength
    ) {
      best = container;
      bestLength = address.length;
    }
    for (const child of container.getChildren()) visit(child);
  }

  visit(root);
  return best;
}

function appendChild(current, parentAddress, child) {
  if (current.getAddress() === parentAddress) {
    return {
      node: cloneContainer(current, [...current.getChildren(), child]),
      changed: true
    };
  }

  let changed = false;
  const children = current.getChildren().map((item) => {
    const result = appendChild(item, parentAddress, child);
    changed ||= result.changed;
    return result.node;
  });

  return {
    node: changed ? cloneContainer(current, children) : current,
    changed
  };
}

function sameContainer(a, b) {
  const aAddress = a.getAddress();
  const bAddress = b.getAddress();
  if (aAddress || bAddress) return Boolean(aAddress && bAddress && aAddress === bAddress);
  return Boolean(a.isWorld?.() && b.isWorld?.());
}

function cloneContainer(source, children) {
  return new Container(
    source.getType(),
    source.getName(),
    source.getAddress(),
    source.getPosition(),
    source.getRotation(),
    source.getColor(),
    source.parameters,
    children
  );
}
