/* ═════════ feature `newproject` — adaptadores Tauri ═════════
   Os comandos do gerador (`platform/tauri/scaffold.ts`) e o diálogo do sistema para escolher a pasta-mãe. */

import { scaffoldClient } from "../../../platform/tauri/scaffold";
import { fsClient } from "../../../platform/tauri/fs";
import { isDesktop, invoke, type Invoker } from "../../../platform/tauri/core";
import type { ScaffoldPort } from "../application/ports";
import { desktopApp } from "./legacy-bridge";

export const tauriScaffold = (inv: Invoker = invoke): ScaffoldPort => {
  const c = scaffoldClient(inv);
  return {
    available: () => isDesktop() && desktopApp(),
    templates: () => c.templates(),
    plan: (parent, name, template, version) => c.plan(parent, name, template, version),
    create: (parent, name, template, version) => c.create(parent, name, template, version),
  };
};

export const pickFolder = (): Promise<string | null> => fsClient().pickFolder();
