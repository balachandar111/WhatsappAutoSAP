import { useMemo, useRef, useState } from "react";
import { nodeChildren } from "./flowUtils";

/*
|--------------------------------------------------------------------------
| FlowMap
|--------------------------------------------------------------------------
| A read-only, auto-laid-out diagram of the current language's question
| tree: one box per node (colored/iconed by nodeType), arrows for every
| "leads to" link (message options, products/steps/form "next"), grouped
| into columns by distance from the Start node. Nodes that can never be
| reached from Start are called out in a warning row at the bottom — a
| common, hard-to-spot mistake in a long list-based editor.
|
| Clicking a node calls onSelectNode(key), which the builder uses to jump
| back to List view scrolled to that node for editing.
*/

const TYPE_META = {
  message: { icon: "💬", label: "Message", color: "#0b7a62", soft: "#e1f5ed" },
  products: { icon: "🛒", label: "Products", color: "#2563eb", soft: "#e8f0fe" },
  steps: { icon: "📋", label: "Steps", color: "#c98a12", soft: "#fdf3dc" },
  form: { icon: "📝", label: "Form", color: "#7c3aed", soft: "#f1ebfe" },
  shop: { icon: "🛍️", label: "Shop", color: "#d9480f", soft: "#fff0e6" },
  checkout: { icon: "🧾", label: "Checkout", color: "#c2255c", soft: "#fde8f1" },
  bulk: { icon: "🎁", label: "Bulk", color: "#0c8599", soft: "#e3f6f9" },
  track: { icon: "📦", label: "Track", color: "#5f3dc4", soft: "#ede8fc" },
  outlets: { icon: "📍", label: "Outlets", color: "#2b8a3e", soft: "#e6f6e9" },
};

const NODE_W = 216;
const NODE_H = 108;
const COL_GAP = 96;
const ROW_GAP = 24;
const PAD = 32;

function nodeSummary(node) {
  const nodeType = node.nodeType || "message";
  if (nodeType === "message") {
    if (node.isEnd) return "Final message";
    const n = (node.options || []).length;
    return n ? `${n} option${n > 1 ? "s" : ""}` : "No options yet";
  }
  if (nodeType === "products") {
    const n = (node.products || []).length;
    return n ? `${n} product card${n > 1 ? "s" : ""}` : "No products yet";
  }
  if (nodeType === "steps") {
    const n = (node.steps || []).length;
    return n ? `${n} step${n > 1 ? "s" : ""}` : "No steps yet";
  }
  if (nodeType === "form") {
    const n = (node.formFields || []).length;
    return n ? `${n} field${n > 1 ? "s" : ""}` : "No fields yet";
  }
  if (nodeType === "shop") {
    const n = (node.shopExtras || []).length;
    const c = (node.shopCategories || []).length;
    return `${c ? `${c} categor${c > 1 ? "ies" : "y"}` : "All categories"} · ${n} extra row${n === 1 ? "" : "s"}`;
  }
  if (nodeType === "checkout") return [node.allowDelivery !== false && "Delivery", node.allowPickup !== false && "Pickup"].filter(Boolean).join(" + ") || "No fulfilment!";
  if (nodeType === "bulk") return `${(node.bulkOccasions || []).length} occasions`;
  if (nodeType === "track") return "Latest order status";
  if (nodeType === "outlets") return "Outlet list + maps";
  return "";
}

// BFS layering from `start`; anything unreached lands in a final "orphan" row.
function layoutFlow(questions, start) {
  const keys = Object.keys(questions);
  const level = {};
  const order = [];
  if (questions[start]) {
    level[start] = 0;
    order.push(start);
    let i = 0;
    while (i < order.length) {
      const k = order[i++];
      const node = questions[k];
      for (const child of nodeChildren(node)) {
        if (questions[child] && !(child in level)) {
          level[child] = level[k] + 1;
          order.push(child);
        }
      }
    }
  }
  const orphans = keys.filter((k) => !(k in level));

  const columns = [];
  order.forEach((k) => {
    const lvl = level[k];
    columns[lvl] = columns[lvl] || [];
    columns[lvl].push(k);
  });

  const positions = {};
  columns.forEach((col, colIdx) => {
    let y = PAD;
    col.forEach((key) => {
      positions[key] = { x: PAD + colIdx * (NODE_W + COL_GAP), y };
      y += NODE_H + ROW_GAP;
    });
  });

  const contentHeight = Math.max(
    ...columns.map((col) => (col ? col.length * (NODE_H + ROW_GAP) - ROW_GAP + PAD * 2 : 0)),
    NODE_H + PAD * 2
  );

  let orphanY = contentHeight + 24;
  orphans.forEach((key, idx) => {
    const colIdx = idx % Math.max(columns.length, 1);
    const row = Math.floor(idx / Math.max(columns.length, 1));
    positions[key] = { x: PAD + colIdx * (NODE_W + COL_GAP), y: orphanY + row * (NODE_H + ROW_GAP) };
  });

  const totalHeight = orphans.length ? orphanY + Math.ceil(orphans.length / Math.max(columns.length, 1)) * (NODE_H + ROW_GAP) + PAD : contentHeight;
  const totalWidth = Math.max(columns.length, 1) * (NODE_W + COL_GAP) - COL_GAP + PAD * 2;

  return { positions, orphans, totalWidth: Math.max(totalWidth, 400), totalHeight: Math.max(totalHeight, 260) };
}

export default function FlowMap({ questions, start, onSelectNode, errorKeys = [] }) {
  const containerRef = useRef(null);
  const dragState = useRef(null);
  const [hovered, setHovered] = useState(null);

  const { positions, orphans, totalWidth, totalHeight } = useMemo(
    () => layoutFlow(questions, start),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, start]
  );

  const edges = useMemo(() => {
    const list = [];
    Object.entries(questions).forEach(([key, node]) => {
      nodeChildren(node).forEach((childKey) => {
        if (positions[key] && positions[childKey]) {
          list.push({ from: key, to: childKey });
        }
      });
    });
    return list;
  }, [questions, positions]);

  const onMouseDown = (e) => {
    if (e.target.closest(".flowmap-node")) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, scrollLeft: containerRef.current.scrollLeft, scrollTop: containerRef.current.scrollTop };
    containerRef.current.style.cursor = "grabbing";
  };
  const onMouseMove = (e) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    containerRef.current.scrollLeft = dragState.current.scrollLeft - dx;
    containerRef.current.scrollTop = dragState.current.scrollTop - dy;
  };
  const endDrag = () => {
    dragState.current = null;
    if (containerRef.current) containerRef.current.style.cursor = "grab";
  };

  if (!Object.keys(questions).length) {
    return <p className="helper-text">Add a question node to see the flow map.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        {Object.entries(TYPE_META).map(([type, meta]) => (
          <span key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: meta.color, display: "inline-block" }} />
            {meta.icon} {meta.label}
          </span>
        ))}
        {orphans.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#9a6f1c" }}>
            ⚠️ Not reachable from Start ({orphans.length})
          </span>
        )}
        <span className="helper-text" style={{ marginLeft: "auto" }}>Drag to pan · click a node to edit it</span>
      </div>

      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background:
            "repeating-linear-gradient(0deg, var(--surface-sunken) 0, var(--surface-sunken) 1px, transparent 1px, transparent 28px), repeating-linear-gradient(90deg, var(--surface-sunken) 0, var(--surface-sunken) 1px, transparent 1px, transparent 28px), #fff",
          cursor: "grab",
          maxHeight: 560,
        }}
      >
        <svg width={totalWidth} height={totalHeight} style={{ display: "block" }}>
          <defs>
            <marker id="flowmap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--primary)" />
            </marker>
          </defs>

          {edges.map(({ from, to }, i) => {
            const a = positions[from];
            const b = positions[to];
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const dx = Math.max(40, (x2 - x1) / 2);
            const active = hovered && (hovered === from || hovered === to);
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={active ? "var(--primary)" : "#b4c4be"}
                strokeWidth={active ? 2.5 : 1.75}
                markerEnd="url(#flowmap-arrow)"
                opacity={hovered && !active ? 0.35 : 1}
              />
            );
          })}

          {Object.entries(questions).map(([key, node]) => {
            const pos = positions[key];
            if (!pos) return null;
            const nodeType = node.nodeType || "message";
            const meta = TYPE_META[nodeType] || TYPE_META.message;
            const isStart = key === start;
            const isOrphan = orphans.includes(key);
            const hasError = errorKeys.includes(key);
            return (
              <foreignObject key={key} x={pos.x} y={pos.y} width={NODE_W} height={NODE_H}>
                <div
                  className="flowmap-node"
                  onClick={() => onSelectNode?.(key)}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                  style={{
                    width: NODE_W - 4,
                    height: NODE_H - 4,
                    background: "#fff",
                    border: `1.5px solid ${hasError ? "#d6453d" : isOrphan ? "#f0b94a" : meta.color}`,
                    borderLeft: `6px solid ${hasError ? "#d6453d" : isOrphan ? "#f0b94a" : meta.color}`,
                    borderRadius: 10,
                    padding: "8px 10px",
                    boxShadow: hovered === key ? "var(--shadow-md)" : "var(--shadow-sm)",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                    transition: "box-shadow .12s ease",
                    boxSizing: "border-box",
                    overflow: "hidden",
                  }}
                  title="Click to edit this node"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 13 }}>{meta.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: 12.5, color: meta.color }}>{key}</span>
                    {isStart && (
                      <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, background: "#e1f5ed", color: "#0b7a62", padding: "1px 6px", borderRadius: 999 }}>
                        START
                      </span>
                    )}
                    {hasError && (
                      <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, background: "#fdeceb", color: "#b42318", padding: "1px 6px", borderRadius: 999 }}>FIX</span>
                    )}
                    {nodeType === "message" && node.isEnd && !isStart && !hasError && (
                      <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, background: "#fdf3e1", color: "#9a6f1c", padding: "1px 6px", borderRadius: 999 }}>
                        END
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-soft)",
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      marginBottom: 6,
                      minHeight: 32,
                    }}
                  >
                    {node.text || (TYPE_META[nodeType]?.label && ["checkout", "track", "outlets"].includes(nodeType) ? <em style={{ color: "#8a8fa8" }}>Uses live shop data</em> : <em style={{ color: "#b3b6c7" }}>No text yet</em>)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{nodeSummary(node)}</div>
                </div>
              </foreignObject>
            );
          })}
        </svg>
      </div>
    </div>
  );
}