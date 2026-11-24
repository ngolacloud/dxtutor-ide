// Studio de arquitectura (F0): regras puras do desenho, sem DOM nem Tauri.
import { describe, test, expect } from "vitest";
import {
  addComponent, connect, emptyDesign, parseDesign, relationFor, removeComponent, removeConnection, slug, toArchitecture,
} from "../src/features/arch/domain/design";

describe("relação inferida dos tipos das pontas", () => {
  test("store, broker e encaminhamento", () => {
    expect(relationFor("service", "store")).toBe("writes");
    expect(relationFor("relay", "store")).toBe("reads");
    expect(relationFor("relay", "broker")).toBe("publishes");
    expect(relationFor("consumer", "broker")).toBe("consumes");
    expect(relationFor("broker", "consumer")).toBe("routes-to");
    expect(relationFor("gateway", "service")).toBe("writes");
  });
});

describe("slug igual ao do backend (arch.rs::scaffold)", () => {
  test("alfanumérico em minúsculas, o resto vira '-' (sem colapsar)", () => {
    expect(slug("Orders API")).toBe("orders-api");
    expect(slug("Fila  de  pedidos")).toBe("fila--de--pedidos");
    expect(slug("Ação")).toBe("ação");
  });
});

describe("operações do desenho", () => {
  test("ids únicos a partir do nome", () => {
    const d = emptyDesign();
    expect(addComponent(d, "service", "Orders")).toBe("orders");
    expect(addComponent(d, "service", "Orders")).toBe("orders-2");
    expect(addComponent(d, "store", "!!!")).toBe("---");
    expect(addComponent(d, "store", "")).toBe("comp");
  });

  test("ligar infere a relação; recusa laços, pontas inexistentes e repetidos", () => {
    const d = emptyDesign();
    addComponent(d, "relay", "relay");
    addComponent(d, "broker", "mq");
    expect(connect(d, "relay", "mq", "order.placed")).toBe(true);
    expect(d.connections[0]).toEqual({ from: "relay", to: "mq", relation: "publishes", event: "order.placed" });
    expect(connect(d, "relay", "mq", "order.placed")).toBe(false);
    expect(connect(d, "relay", "relay")).toBe(false);
    expect(connect(d, "relay", "ghost")).toBe(false);
  });

  test("remover um componente leva as ligações que lhe tocam", () => {
    const d = emptyDesign();
    addComponent(d, "service", "svc");
    addComponent(d, "store", "db");
    addComponent(d, "relay", "relay");
    connect(d, "svc", "db");
    connect(d, "relay", "db");
    removeComponent(d, "db");
    expect(d.components.map((c) => c.id)).toEqual(["svc", "relay"]);
    expect(d.connections).toEqual([]);
    removeConnection(d, 5); // fora do intervalo: nada
  });

  test("toArchitecture tira a geometria", () => {
    const d = emptyDesign();
    addComponent(d, "store", "db");
    expect(toArchitecture(d)).toEqual({ components: [{ id: "db", name: "db", kind: "store", outbox: false }], connections: [] });
  });
});

describe("leitura do desenho guardado (retrocompatível com o Studio do ui-next)", () => {
  const old = {
    components: [
      { id: "svc", name: "Orders", kind: "service", outbox: false, x: 24, y: 24 },
      { id: "db", name: "Outbox", kind: "store", outbox: true, x: 204, y: 24 },
    ],
    connections: [{ from: "svc", to: "db", relation: "writes", event: "" }],
  };

  test("o formato antigo abre igual", () => {
    expect(parseDesign(JSON.parse(JSON.stringify(old)))).toEqual(old);
  });

  test("entradas inválidas caem; o resto abre", () => {
    const d = parseDesign({
      components: [...old.components, { id: "x", kind: "spaceship" }, { id: "svc", kind: "store" }, null],
      connections: [...old.connections, { from: "a", to: "b", relation: "teleports" }],
    });
    expect(d.components.map((c) => c.id)).toEqual(["svc", "db"]);
    expect(d.connections.length).toBe(1);
  });

  test("lixo ou nada → desenho vazio (nunca dados de demonstração)", () => {
    for (const raw of [null, undefined, 42, "x", {}, { components: [] }]) expect(parseDesign(raw)).toEqual(emptyDesign());
  });

  test("ligações penduradas mantêm-se: é o backend que as acusa (dangling-edge)", () => {
    const d = parseDesign({ components: [], connections: [{ from: "a", to: "b", relation: "writes", event: "" }] });
    expect(d.connections.length).toBe(1);
  });
});
