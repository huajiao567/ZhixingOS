let editorModulePromise: Promise<typeof import('./Mirror3DEditor')> | null = null;

/**
 * Keep one shared dynamic-import promise so route prefetch and React.lazy do
 * not compile/download the heavy Three.js editor twice.
 */
export function loadMirror3DEditor() {
  if (!editorModulePromise) {
    editorModulePromise = import('./Mirror3DEditor');
  }
  return editorModulePromise;
}

export function preloadMirror3DEditor(): void {
  void loadMirror3DEditor();
}
