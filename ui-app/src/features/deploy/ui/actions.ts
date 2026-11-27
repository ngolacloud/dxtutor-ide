/* ═══════════ feature `deploy` — as acções `deploy:*` no despachante partilhado (ADR-0004 U5). Cablagem pura. */
import { registerActions } from "../../../app/actions";
import type { Deploy } from "../application/deploy-service";

export function bindActions(d: Deploy): void {
  registerActions({
    "deploy:plan": { click: (c) => { void d.plan(c.on); } },
    "deploy:toggle": { click: (c) => d.toggle(c.on) },
    "deploy:waive": { click: (c) => { c.stop(); void d.waive(c.on); } },
    "deploy:unwaive": { click: (c) => { c.stop(); d.unwaive(c.on); } },
    "deploy:rollout": { click: () => { void d.rollout(); } },
  });
}
