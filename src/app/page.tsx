"use client";

import { useMemo, useState } from "react";

type FlipFlopType = "SR" | "JK" | "D" | "T";

type TickRow = {
  tick: number;
  type: FlipFlopType;
  inputs: string;
  qPrev: number;
  qNext: number;
  note?: string;
};

type StateNode = { id: string; output: string; x: number; y: number };
type Transition = { from: string; to: string; condition: string };
type Drag = { id: string; dx: number; dy: number };

const SVG_W = 600;
const SVG_H = 260;
const NODE_R = 28;

function resolveFlipFlop(type: FlipFlopType, qPrev: number, bits: Record<string, number>) {
  if (type === "SR") {
    const { s, r } = bits;
    if (s === 1 && r === 1) return { qNext: qPrev, note: "Invalid SR (S=1,R=1)" };
    if (s === 1) return { qNext: 1 };
    if (r === 1) return { qNext: 0 };
    return { qNext: qPrev };
  }
  if (type === "JK") {
    const { j, k } = bits;
    if (j === 0 && k === 0) return { qNext: qPrev };
    if (j === 0 && k === 1) return { qNext: 0 };
    if (j === 1 && k === 0) return { qNext: 1 };
    return { qNext: qPrev === 1 ? 0 : 1 };
  }
  if (type === "D") return { qNext: bits.d };
  return { qNext: qPrev ^ bits.t };
}

function expandCondition(pattern: string, inputBits: number): string[] {
  const normalized = pattern.trim().toLowerCase();
  const chars = normalized.length === inputBits ? normalized.split("") : Array.from({ length: inputBits }, () => "x");
  const out: string[] = [""];
  for (const c of chars) {
    if (c === "0" || c === "1") {
      for (let i = 0; i < out.length; i += 1) out[i] += c;
    } else {
      const size = out.length;
      for (let i = 0; i < size; i += 1) {
        out.push(`${out[i]}1`);
        out[i] += "0";
      }
    }
  }
  return out;
}

function combine(a: string, b: string) {
  let diff = 0;
  let idx = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      if (a[i] === "-" || b[i] === "-") return null;
      diff += 1;
      idx = i;
    }
    if (diff > 1) return null;
  }
  if (diff !== 1) return null;
  return `${a.slice(0, idx)}-${a.slice(idx + 1)}`;
}

function covers(implicant: string, minterm: string) {
  for (let i = 0; i < implicant.length; i += 1) {
    if (implicant[i] !== "-" && implicant[i] !== minterm[i]) return false;
  }
  return true;
}

function minimizeSop(minterms: string[]) {
  const unique = Array.from(new Set(minterms));
  if (unique.length === 0) return [];

  let groups = unique.map((m) => ({ pattern: m, merged: false }));
  const primes: string[] = [];

  while (groups.length > 0) {
    const nextPatterns = new Set<string>();
    const next: Array<{ pattern: string; merged: boolean }> = [];

    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const merged = combine(groups[i].pattern, groups[j].pattern);
        if (merged) {
          groups[i].merged = true;
          groups[j].merged = true;
          if (!nextPatterns.has(merged)) {
            nextPatterns.add(merged);
            next.push({ pattern: merged, merged: false });
          }
        }
      }
    }

    for (const g of groups) {
      if (!g.merged && !primes.includes(g.pattern)) primes.push(g.pattern);
    }
    groups = next;
  }

  const remaining = new Set(unique);
  const chart = new Map<string, string[]>();
  for (const m of unique) {
    chart.set(
      m,
      primes.filter((p) => covers(p, m)),
    );
  }

  const chosen = new Set<string>();
  for (const m of unique) {
    const cands = chart.get(m) ?? [];
    if (cands.length === 1) chosen.add(cands[0]);
  }

  for (const m of Array.from(remaining)) {
    if (Array.from(chosen).some((c) => covers(c, m))) remaining.delete(m);
  }

  while (remaining.size > 0) {
    let best = "";
    let score = -1;
    for (const p of primes) {
      if (chosen.has(p)) continue;
      let hit = 0;
      for (const m of remaining) if (covers(p, m)) hit += 1;
      if (hit > score) {
        score = hit;
        best = p;
      }
    }
    if (!best) break;
    chosen.add(best);
    for (const m of Array.from(remaining)) if (covers(best, m)) remaining.delete(m);
  }

  return Array.from(chosen);
}

function implicantToExpression(implicant: string, vars: string[]) {
  const terms: string[] = [];
  for (let i = 0; i < implicant.length; i += 1) {
    if (implicant[i] === "-") continue;
    terms.push(implicant[i] === "1" ? vars[i] : `!${vars[i]}`);
  }
  return terms.length ? terms.join(" & ") : "1";
}

export default function Home() {
  const [ffType, setFfType] = useState<FlipFlopType>("SR");
  const [clock, setClock] = useState(0);
  const [q, setQ] = useState(0);
  const [inputs, setInputs] = useState({ s: 0, r: 0, j: 0, k: 0, d: 0, t: 0 });
  const [ticks, setTicks] = useState<TickRow[]>([]);

  const [inputBits, setInputBits] = useState(1);
  const [states, setStates] = useState<StateNode[]>([
    { id: "A", output: "0", x: 180, y: 130 },
    { id: "B", output: "1", x: 420, y: 130 },
  ]);
  const [transitions, setTransitions] = useState<Transition[]>([
    { from: "A", to: "A", condition: "0" },
    { from: "A", to: "B", condition: "1" },
    { from: "B", to: "A", condition: "0" },
    { from: "B", to: "B", condition: "1" },
  ]);
  const [newState, setNewState] = useState("C");
  const [newOutput, setNewOutput] = useState("0");
  const [newTransition, setNewTransition] = useState<Transition>({ from: "A", to: "B", condition: "1" });
  const [drag, setDrag] = useState<Drag | null>(null);

  const stateBits = Math.max(1, Math.ceil(Math.log2(Math.max(states.length, 1))));
  const encoding = useMemo(() => {
    const map = new Map<string, string>();
    states.forEach((s, idx) => map.set(s.id, idx.toString(2).padStart(stateBits, "0")));
    return map;
  }, [states, stateBits]);

  const stateRows = useMemo(() => {
    const rows: Array<{ present: string; input: string; next: string; output: string }> = [];
    for (const tr of transitions) {
      const fromNode = states.find((s) => s.id === tr.from);
      for (const combo of expandCondition(tr.condition, inputBits)) {
        rows.push({
          present: tr.from,
          input: combo,
          next: tr.to,
          output: fromNode?.output ?? "0",
        });
      }
    }
    return rows;
  }, [transitions, states, inputBits]);

  const equations = useMemo(() => {
    const qVars = Array.from({ length: stateBits }, (_, i) => `Q${stateBits - i - 1}`);
    const xVars = Array.from({ length: inputBits }, (_, i) => `X${i}`);
    const allVars = [...qVars, ...xVars];
    const minterms = Array.from({ length: stateBits }, () => [] as string[]);

    for (const tr of transitions) {
      const fromCode = encoding.get(tr.from);
      const toCode = encoding.get(tr.to);
      if (!fromCode || !toCode) continue;

      for (const combo of expandCondition(tr.condition, inputBits)) {
        const joined = `${fromCode}${combo}`;
        for (let bit = 0; bit < stateBits; bit += 1) {
          if (toCode[bit] === "1") minterms[bit].push(joined);
        }
      }
    }

    return minterms.map((m, i) => {
      const simplified = minimizeSop(m);
      const rhs = simplified.length ? simplified.map((imp) => implicantToExpression(imp, allVars)).join(" | ") : "0";
      return `D${stateBits - i - 1} = ${rhs}`;
    });
  }, [transitions, encoding, inputBits, stateBits]);

  const visibleInputs = ffType === "SR" ? ["s", "r"] : ffType === "JK" ? ["j", "k"] : ffType === "D" ? ["d"] : ["t"];

  function tickClock() {
    const nextClock = clock === 1 ? 0 : 1;
    setClock(nextClock);
    if (clock === 0 && nextClock === 1) {
      const result = resolveFlipFlop(ffType, q, inputs);
      const qNext = result.qNext;
      const row: TickRow = {
        tick: ticks.length + 1,
        type: ffType,
        inputs: visibleInputs.map((k) => `${k.toUpperCase()}=${inputs[k as keyof typeof inputs]}`).join(" "),
        qPrev: q,
        qNext,
        note: result.note,
      };
      setQ(qNext);
      setTicks((prev) => [row, ...prev].slice(0, 16));
    }
  }

  function addState() {
    const id = newState.trim().toUpperCase();
    if (!id || states.some((s) => s.id === id)) return;
    const angle = (states.length / Math.max(states.length + 1, 1)) * Math.PI * 2;
    const x = 300 + Math.cos(angle) * 160;
    const y = 130 + Math.sin(angle) * 80;
    setStates((prev) => [...prev, { id, output: newOutput.trim() || "0", x, y }]);
  }

  function deleteState(stateId: string) {
    if (states.length <= 1) return;
    setStates((prev) => prev.filter((s) => s.id !== stateId));
    setTransitions((prev) => prev.filter((t) => t.from !== stateId && t.to !== stateId));
    setNewTransition((prev) => {
      const fallback = states.find((s) => s.id !== stateId)?.id ?? "";
      return {
        from: prev.from === stateId ? fallback : prev.from,
        to: prev.to === stateId ? fallback : prev.to,
        condition: prev.condition,
      };
    });
  }

  function startDrag(node: StateNode, clientX: number, clientY: number) {
    setDrag({ id: node.id, dx: node.x - clientX, dy: node.y - clientY });
  }

  function onCanvasMove(clientX: number, clientY: number) {
    if (!drag) return;
    setStates((prev) =>
      prev.map((s) => {
        if (s.id !== drag.id) return s;
        const nx = Math.max(NODE_R, Math.min(SVG_W - NODE_R, clientX + drag.dx));
        const ny = Math.max(NODE_R, Math.min(SVG_H - NODE_R, clientY + drag.dy));
        return { ...s, x: nx, y: ny };
      }),
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Digital Logic Lab</p>
        <h1>Flip-flop and FSM playground</h1>
        <p>See SR/JK/D/T timing behavior, drag states on-canvas, edit transitions, and get simplified next-state logic.</p>
      </section>

      <div className="grid">
        <section className="card">
          <h2>Flip-Flop Visualizer</h2>
          <div className="controls">
            <label>
              Type
              <select value={ffType} onChange={(e) => setFfType(e.target.value as FlipFlopType)}>
                <option>SR</option>
                <option>JK</option>
                <option>D</option>
                <option>T</option>
              </select>
            </label>
            <div className="bit-row">
              {visibleInputs.map((key) => (
                <button
                  type="button"
                  key={key}
                  className="bit"
                  onClick={() => setInputs((prev) => ({ ...prev, [key]: prev[key as keyof typeof prev] === 1 ? 0 : 1 }))}
                >
                  {key.toUpperCase()} = {inputs[key as keyof typeof inputs]}
                </button>
              ))}
            </div>
            <button type="button" className="primary" onClick={tickClock}>
              Tick Clock (rising-edge update)
            </button>
          </div>

          <div className="status">
            <span>Clock: {clock}</span>
            <span>Q: {q}</span>
          </div>

          <table>
            <thead>
              <tr>
                <th>Tick</th>
                <th>Type</th>
                <th>Inputs</th>
                <th>Q(prev)</th>
                <th>Q(next)</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {ticks.length === 0 ? (
                <tr>
                  <td colSpan={6}>No events yet. Toggle bits and tick the clock.</td>
                </tr>
              ) : (
                ticks.map((row) => (
                  <tr key={row.tick}>
                    <td>{row.tick}</td>
                    <td>{row.type}</td>
                    <td>{row.inputs}</td>
                    <td>{row.qPrev}</td>
                    <td>{row.qNext}</td>
                    <td>{row.note ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Finite State Machine Builder</h2>
          <div className="controls split">
            <label>
              Input bits
              <input
                type="number"
                min={1}
                max={3}
                value={inputBits}
                onChange={(e) => setInputBits(Math.min(3, Math.max(1, Number(e.target.value) || 1)))}
              />
            </label>
            <label>
              New state
              <input value={newState} onChange={(e) => setNewState(e.target.value.toUpperCase())} />
            </label>
            <label>
              Output
              <input value={newOutput} onChange={(e) => setNewOutput(e.target.value)} />
            </label>
            <button type="button" className="primary" onClick={addState}>
              Add State
            </button>
          </div>

          <div className="state-editor">
            <h3>States</h3>
            {states.map((s) => (
              <div className="state-row" key={s.id}>
                <span>
                  {s.id} (z={s.output})
                </span>
                <button type="button" className="danger" onClick={() => deleteState(s.id)} disabled={states.length <= 1}>
                  Delete State
                </button>
              </div>
            ))}
          </div>

          <div className="controls split">
            <label>
              From
              <select value={newTransition.from} onChange={(e) => setNewTransition((p) => ({ ...p, from: e.target.value }))}>
                {states.map((s) => (
                  <option key={s.id}>{s.id}</option>
                ))}
              </select>
            </label>
            <label>
              To
              <select value={newTransition.to} onChange={(e) => setNewTransition((p) => ({ ...p, to: e.target.value }))}>
                {states.map((s) => (
                  <option key={s.id}>{s.id}</option>
                ))}
              </select>
            </label>
            <label>
              Condition
              <input
                value={newTransition.condition}
                onChange={(e) => setNewTransition((p) => ({ ...p, condition: e.target.value.replace(/[^01xX]/g, "").toLowerCase() }))}
                placeholder={"x".repeat(inputBits)}
              />
            </label>
            <button
              type="button"
              className="primary"
              onClick={() => setTransitions((prev) => [...prev, { ...newTransition, condition: newTransition.condition || "x".repeat(inputBits) }])}
            >
              Add Transition
            </button>
          </div>

          <div className="fsm-canvas">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              role="img"
              aria-label="FSM diagram"
              onPointerMove={(e) => onCanvasMove(e.nativeEvent.offsetX, e.nativeEvent.offsetY)}
              onPointerUp={() => setDrag(null)}
              onPointerLeave={() => setDrag(null)}
            >
              <defs>
                <marker id="fsm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
                </marker>
              </defs>

              {transitions.map((tr, i) => {
                const from = states.find((s) => s.id === tr.from);
                const to = states.find((s) => s.id === tr.to);
                if (!from || !to) return null;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const ox = (dx / len) * NODE_R;
                const oy = (dy / len) * NODE_R;
                const x1 = from.x + ox;
                const y1 = from.y + oy;
                const x2 = to.x - ox;
                const y2 = to.y - oy;
                const sameState = from.id === to.id;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2 - 10;
                return (
                  <g key={`${tr.from}-${tr.to}-${tr.condition}-${i}`}>
                    {sameState ? (
                      <>
                        <path
                          d={`M ${from.x - 2} ${from.y - NODE_R} C ${from.x - 50} ${from.y - 70}, ${from.x + 50} ${from.y - 70}, ${from.x + 2} ${from.y - NODE_R}`}
                          className="edge"
                          markerEnd="url(#fsm-arrow)"
                        />
                        <text x={from.x} y={from.y - 78} textAnchor="middle" className="edge-label">
                          {tr.condition}
                        </text>
                      </>
                    ) : (
                      <>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} className="edge" markerEnd="url(#fsm-arrow)" />
                        <text x={mx} y={my} textAnchor="middle" className="edge-label">
                          {tr.condition}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {states.map((s) => (
                <g
                  key={s.id}
                  className="draggable"
                  onPointerDown={(e) => {
                    (e.target as Element).setPointerCapture(e.pointerId);
                    startDrag(s, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                  }}
                >
                  <circle cx={s.x} cy={s.y} r={NODE_R} className="node" />
                  <text x={s.x} y={s.y - 2} textAnchor="middle" className="node-label">
                    {s.id}
                  </text>
                  <text x={s.x} y={s.y + 12} textAnchor="middle" className="node-sub">
                    z={s.output}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <div className="transition-editor">
            <h3>Transitions</h3>
            {transitions.map((tr, idx) => (
              <div className="transition-row" key={`${tr.from}-${tr.to}-${tr.condition}-${idx}`}>
                <select
                  value={tr.from}
                  onChange={(e) =>
                    setTransitions((prev) => prev.map((p, i) => (i === idx ? { ...p, from: e.target.value } : p)))
                  }
                >
                  {states.map((s) => (
                    <option key={s.id}>{s.id}</option>
                  ))}
                </select>
                <span className="arrow">-&gt;</span>
                <select
                  value={tr.to}
                  onChange={(e) =>
                    setTransitions((prev) => prev.map((p, i) => (i === idx ? { ...p, to: e.target.value } : p)))
                  }
                >
                  {states.map((s) => (
                    <option key={s.id}>{s.id}</option>
                  ))}
                </select>
                <input
                  value={tr.condition}
                  placeholder={"x".repeat(inputBits)}
                  onChange={(e) =>
                    setTransitions((prev) =>
                      prev.map((p, i) =>
                        i === idx ? { ...p, condition: e.target.value.replace(/[^01xX]/g, "").toLowerCase() || "x".repeat(inputBits) } : p,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="danger"
                  onClick={() => setTransitions((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <table>
            <thead>
              <tr>
                <th>Present</th>
                <th>Input</th>
                <th>Next</th>
                <th>Output</th>
                <th>Code(Present)</th>
                <th>Code(Next)</th>
              </tr>
            </thead>
            <tbody>
              {stateRows.map((row, i) => (
                <tr key={`${row.present}-${row.input}-${i}`}>
                  <td>{row.present}</td>
                  <td>{row.input}</td>
                  <td>{row.next}</td>
                  <td>{row.output}</td>
                  <td>{encoding.get(row.present)}</td>
                  <td>{encoding.get(row.next)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="logic">
            <h3>Next-state logic (K-map style simplified)</h3>
            {equations.map((eq) => (
              <code key={eq}>{eq}</code>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
