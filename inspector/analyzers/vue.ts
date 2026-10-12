import type { Page } from "playwright";
import type { VueAnalysis } from "../../shared/protocol.ts";

const MAX_SCAN_NODES = 3_000;
const MAX_COMPONENT_NODES = 500;
const MAX_COMPONENT_NAMES = 60;

/**
 * Detects Vue per page and, when the page exposes Vue's runtime mount instance,
 * returns only component names and counts. Props, component state, and app data
 * are intentionally never read or serialized.
 */
export async function analyzeVuePage(page: Page): Promise<VueAnalysis> {
  return page.evaluate(() => {
    type AnyRecord = Record<string, any>;
    type VueElement = HTMLElement & { __vue_app__?: AnyRecord; __vue__?: AnyRecord };

    const safeName = (value: unknown): string => {
      if (typeof value !== "string" || value.length === 0) return "";
      return /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/u.test(value) ? value : "[dynamic-component]";
    };

    const names = new Set<string>();
    const signals = new Set<string>();
    const seenVNodes = new WeakSet<object>();
    const seenInstances = new WeakSet<object>();
    let componentCount = 0;
    let truncated = false;
    let version: string | undefined;
    let framework: "vue" | "react" | "unknown" = "unknown";
    let status: "analyzed" | "detected_no_component_tree" | "not_applicable" | "not_detected" = "not_detected";

    const addName = (candidate: unknown) => {
      const name = safeName(candidate);
      if (!name) return;
      if (names.size < 60) names.add(name);
      else truncated = true;
    };

    const componentName = (type: AnyRecord | undefined): string => {
      if (!type || typeof type !== "object") return "";
      return safeName(type.name) || safeName(type.__name) || safeName(type.displayName) || "";
    };

    const visitVue2 = (instance: AnyRecord, depth: number) => {
      if (!instance || typeof instance !== "object" || seenInstances.has(instance)) return;
      if (componentCount >= 500 || depth > 40) {
        truncated = true;
        return;
      }
      seenInstances.add(instance);
      componentCount++;
      const options = instance.$options;
      addName(options?.name || options?._componentTag || options?._component?.name);
      const children = Array.isArray(instance.$children) ? instance.$children : [];
      for (const child of children.slice(0, 100)) visitVue2(child, depth + 1);
      if (children.length > 100) truncated = true;
    };

    const visitVue3VNode = (vnode: AnyRecord, depth: number) => {
      if (!vnode || typeof vnode !== "object" || seenVNodes.has(vnode)) return;
      if (componentCount >= 500 || depth > 40) {
        truncated = true;
        return;
      }
      seenVNodes.add(vnode);

      const instance = vnode.component as AnyRecord | undefined;
      if (instance && typeof instance === "object" && !seenInstances.has(instance)) {
        seenInstances.add(instance);
        componentCount++;
        addName(componentName(instance.type) || componentName(instance.type?.options));
        if (instance.subTree) visitVue3VNode(instance.subTree, depth + 1);
      }
      if (vnode.subTree) visitVue3VNode(vnode.subTree, depth + 1);
      if (Array.isArray(vnode.children)) {
        for (const child of vnode.children.slice(0, 100)) {
          if (child && typeof child === "object") visitVue3VNode(child as AnyRecord, depth + 1);
        }
        if (vnode.children.length > 100) truncated = true;
      }
    };

    const nodes = document.querySelectorAll("*");
    const scanLimit = Math.min(nodes.length, 3_000);
    let vue2Root: AnyRecord | undefined;
    let vue3App: AnyRecord | undefined;
    let reactDetected = false;

    for (let index = 0; index < scanLimit; index++) {
      const element = nodes[index] as VueElement;
      if (!vue3App && element.__vue_app__ && typeof element.__vue_app__ === "object") {
        vue3App = element.__vue_app__;
        signals.add("vue3_mount_instance");
      }
      if (!vue2Root && element.__vue__ && typeof element.__vue__ === "object") {
        vue2Root = element.__vue__;
        signals.add("vue2_component_instance");
      }
      if (!reactDetected && Object.keys(element).some((key) =>
        /^__react(?:Fiber|Container)\$/u.test(key),
      )) {
        reactDetected = true;
      }
      if (vue3App && vue2Root && reactDetected) break;
    }
    if (nodes.length > scanLimit) truncated = true;

    const globalWindow = window as unknown as AnyRecord;
    const globalVueVersion = globalWindow.Vue?.version;
    const hook = globalWindow.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    if (hook) signals.add("vue_devtools_hook");

    if (vue3App) {
      framework = "vue";
      status = "detected_no_component_tree";
      version = typeof vue3App.version === "string" ? vue3App.version : undefined;
      const rootInstance = vue3App._instance as AnyRecord | undefined;
      if (rootInstance && typeof rootInstance === "object") {
        seenInstances.add(rootInstance);
        componentCount = 1;
        addName(componentName(rootInstance.type) || componentName(rootInstance.type?.options));
        if (rootInstance.subTree) visitVue3VNode(rootInstance.subTree, 0);
      }
      if (componentCount > 0) status = "analyzed";
    } else if (vue2Root) {
      framework = "vue";
      status = "detected_no_component_tree";
      const constructor = vue2Root.constructor as AnyRecord | undefined;
      version = typeof constructor?.version === "string" ? constructor.version : undefined;
      componentCount = 0;
      visitVue2(vue2Root, 0);
      if (componentCount > 0) status = "analyzed";
    } else if (typeof globalVueVersion === "string") {
      framework = "vue";
      status = "detected_no_component_tree";
      version = globalVueVersion;
      signals.add("global_vue_runtime");
    } else if (reactDetected) {
      framework = "react";
      status = "not_applicable";
      signals.add("react_fiber_marker");
    }

    if (framework === "unknown" && status === "not_detected") {
      signals.clear();
    }

    return {
      framework,
      status,
      ...(version ? { version: version.slice(0, 40) } : {}),
      detectionSignals: [...signals].slice(0, 8),
      ...(framework === "vue" ? {
        componentCount,
        componentNames: [...names],
        ...(truncated ? { componentNamesTruncated: true } : {}),
      } : {}),
      ...(truncated ? { scanTruncated: true } : {}),
    };
  });
}
