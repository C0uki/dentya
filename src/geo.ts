import type { Graph, GraphNode, SquareKind } from "./types";
import { CITIES, EDGES, COAST } from "./data";

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 経度・緯度 → 平面座標への投影 */
export const PRJX = (lon: number): number => (lon - 126.8) * 76;
export const PRJY = (lat: number): number => (46.0 - lat) * 90;

/** 俯瞰(2.5D)用にY軸を圧縮して描画するための係数と変換 */
export const FLAT = 0.6;
export const FY = (y: number): number => y * FLAT;

function buildGraph(): Graph {
  const rng = mulberry32(20260703);
  const nodes: GraphNode[] = [];
  const adj: number[][] = [];
  const cityIdx: Record<string, number> = {};

  CITIES.forEach((c, i) => {
    cityIdx[c[0]] = nodes.length;
    nodes.push({ type: "city", name: c[0], x: PRJX(c[1]), y: PRJY(c[2]), ci: i, pw: c[0].length * 10.5 + 14 });
    adj.push([]);
  });

  const cityCount = CITIES.length;
  const anchors = nodes.slice(0, cityCount).map((n) => ({ x: n.x, y: n.y }));
  const polys = COAST.map((isl) => isl.map((p) => [PRJX(p[0]), PRJY(p[1])] as [number, number]));
  const inland = (x: number, y: number): boolean =>
    polys.some((poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    });

  // 過密地帯(関東・関西など)は駅名標が重ならないよう押し広げる。
  // 駅名標は横長なので、実際の看板の縦横サイズを考慮した「楕円距離」で判定し、
  // 縦にずらせば済むペアは縦にずらす(移動量が最小で済む)。
  // 「元の位置から離れすぎない」「海の上に出ない」の2制約も毎ラウンド適用し、
  // 3つの条件を同時に満たす配置へ収束させる。
  for (let round = 0; round < 80; round++) {
    for (let a = 0; a < cityCount; a++) {
      for (let b = a + 1; b < cityCount; b++) {
        const A = nodes[a] as Extract<GraphNode, { type: "city" }>;
        const B = nodes[b] as Extract<GraphNode, { type: "city" }>;
        const needX = (A.pw + B.pw) / 2 + 8; // 看板の幅ぶん+余白
        const needY = 46; // 描画時にY軸が0.6倍に圧縮されるため論理座標では広めに
        let dx = (B.x - A.x) / needX, dy = (B.y - A.y) / needY;
        let d = Math.hypot(dx, dy);
        if (d >= 1) continue; // 重なっていない
        if (d < 0.001) { dy = 0.001; d = 0.001; }
        const push = (1 - d) / 2 / d;
        const mx = dx * push * needX, my = dy * push * needY;
        A.x -= mx; A.y -= my;
        B.x += mx; B.y += my;
      }
    }
    for (let a = 0; a < cityCount; a++) {
      const A = nodes[a], an = anchors[a];
      const dx = A.x - an.x, dy = A.y - an.y, d = Math.hypot(dx, dy), cap = 40;
      if (d > cap) { A.x = an.x + (dx / d) * cap; A.y = an.y + (dy / d) * cap; }
      if (!inland(A.x, A.y) && inland(an.x, an.y)) {
        let fixed = false;
        for (let t = 0.2; t < 1 && !fixed; t += 0.2) {
          const x = A.x + (an.x - A.x) * t, y = A.y + (an.y - A.y) * t;
          if (inland(x, y)) { A.x = x; A.y = y; fixed = true; }
        }
        if (!fixed) { A.x = an.x; A.y = an.y; }
      }
    }
  }

  const link = (a: number, b: number): void => { adj[a].push(b); adj[b].push(a); };
  const edgeLines: Graph["edgeLines"] = [];
  for (const [an, bn, kk, sea] of EDGES) {
    const k = kk >= 2 ? kk - 1 : kk; // 全体をおよそ200駅に調整
    const a = cityIdx[an], b = cityIdx[bn];
    const A = nodes[a], B = nodes[b];
    let prev = a;
    const chain = [a];
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1);
      const nx = A.x + (B.x - A.x) * t, ny = A.y + (B.y - A.y) * t;
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      const off = (rng() - 0.5) * 22;
      const r = rng();
      const type: SquareKind = r < 0.32 ? "blue" : r < 0.56 ? "red" : r < 0.8 ? "card" : r < 0.9 ? "lotto" : "warp";
      const id = nodes.length;
      nodes.push({ type, x: nx - (dy / len) * off, y: ny + (dx / len) * off, sea: !!sea });
      adj.push([]);
      link(prev, id); prev = id; chain.push(id);
    }
    link(prev, b); chain.push(b);
    edgeLines.push({ chain, sea: !!sea });
  }

  // 中間マスが駅名標の裏に隠れないよう、看板の外へ押し出す。
  // 左右に出すか上下に出すか、移動量が小さいほうを選ぶ。
  for (let pass = 0; pass < 3; pass++) {
    for (let i = cityCount; i < nodes.length; i++) {
      const sq = nodes[i];
      for (let c = 0; c < cityCount; c++) {
        const cn = nodes[c] as Extract<GraphNode, { type: "city" }>;
        const dx = sq.x - cn.x;
        const dyF = (sq.y - cn.y) * FLAT; // 俯瞰描画上の縦距離
        const halfW = cn.pw / 2 + 13, top = -26, bottom = 21; // 看板+マスの外形(描画座標)
        if (Math.abs(dx) >= halfW || dyF <= top || dyF >= bottom) continue;
        const pushX = dx >= 0 ? halfW - dx : -(halfW + dx);
        const pushYF = dyF >= (top + bottom) / 2 ? bottom - dyF : top - dyF;
        if (Math.abs(pushX) <= Math.abs(pushYF) / FLAT) sq.x += pushX;
        else sq.y += pushYF / FLAT;
      }
    }
  }

  return { nodes, adj, cityIdx, edgeLines };
}

/** ゲーム全体で共有する路線グラフ(起動時に一度だけ構築、固定シードなので毎回同じ盤面になる) */
export const G: Graph = buildGraph();

export function distsFrom(src: number): number[] {
  const d = new Array(G.nodes.length).fill(-1);
  d[src] = 0;
  const q = [src];
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const v of G.adj[u]) if (d[v] < 0) { d[v] = d[u] + 1; q.push(v); }
  }
  return d;
}

export const bfsDist = (a: number, b: number): number => distsFrom(a)[b];

/** ノードが都市駅であることを前提に駅名を取得する(目的地・現在地は常に都市ノード) */
export function cityName(nodeIndex: number): string {
  const n = G.nodes[nodeIndex];
  return n.type === "city" ? n.name : "";
}
