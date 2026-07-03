import type { ModalOptions, Player } from "./types";
import { CITIES, CARDS, PCOLORS } from "./data";
import { bfsDist, cityName } from "./geo";
import {
  S, fmtMoney, propOwners, isMonopoly, playerIncome, propValue, totalAssets, currentPrize, yearOf, monthOf,
} from "./state";
import { BONBI_LABEL } from "./data";
import { resolveAction } from "./input";
import { updateOwnDots, drawTokens, drawDest, drawDrops } from "./render";

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

export function log(msg: string, kind?: string): void {
  const p = document.createElement("p");
  if (kind) p.className = kind;
  p.textContent = msg;
  $("log").prepend(p);
  while ($("log").children.length > 70) $("log").lastChild?.remove();
}

let bannerTimer: ReturnType<typeof setTimeout> | null = null;
export function banner(msg: string, kind?: string, hold?: boolean): void {
  const b = $("banner");
  b.textContent = msg;
  b.className = "show" + (kind ? " " + kind : "");
  if (bannerTimer) clearTimeout(bannerTimer);
  if (!hold) bannerTimer = setTimeout(() => b.classList.remove("show"), 2200 * S.speed + 800);
}
export function hideBanner(): void {
  $("banner").classList.remove("show");
}

export function modal<T = boolean>(opts: ModalOptions): Promise<T> {
  return new Promise((res) => {
    const ov = $("overlay");
    ov.innerHTML = "";
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<header class="${opts.headKlass || ""}">${opts.title}</header><div class="body">${opts.html || ""}</div><div class="btns"></div>`;
    const btns = m.querySelector(".btns") as HTMLElement;
    (opts.buttons || [{ label: "OK", value: true, primary: true }]).forEach((b) => {
      const bt = document.createElement("button");
      bt.className = "mbtn" + (b.primary ? " primary" : "");
      bt.textContent = b.label;
      bt.onclick = () => {
        ov.classList.remove("show");
        ov.innerHTML = "";
        res(b.value as T);
      };
      btns.appendChild(bt);
    });
    ov.appendChild(m);
    ov.classList.add("show");
    (m.querySelector(".mbtn") as HTMLElement)?.focus();
  });
}

export function ownerTag(o: number): string {
  return o < 0
    ? `<span class="ownedby" style="background:#B9BDC7">なし</span>`
    : `<span class="ownedby" style="background:${PCOLORS[o]}">${S.players[o].name}</span>`;
}

export function updateHUD(): void {
  $("tbyear").textContent = `${yearOf()}年目`;
  $("tbmonth").textContent = `${monthOf()}月`;
  const p = S.players[S.turn];
  if (p) {
    $("tbchip").style.background = p.color;
    $("tbname").textContent = `${p.name}のばん`;
    const cash = $("tbcash");
    cash.textContent = `持ち金 ${fmtMoney(p.cash)}`;
    cash.classList.toggle("minus", p.cash < 0);
  }
  const d = p ? bfsDist(p.pos, S.dest) : 0;
  $("tbdest").innerHTML = S.dest < 0 ? "" :
    `<span class="to">▼${cityName(S.dest)}</span> まで ${d} マス<small>とうちゃく援助金 ${fmtMoney(currentPrize())}</small>`;
}

export function updateRanking(): void {
  const list = [...S.players].sort((a, b) => totalAssets(b) - totalAssets(a));
  const ranking = $("ranking");
  ranking.innerHTML = "";
  list.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "prow" + (p.i === S.turn ? " active" : "");
    const bon = S.bonbi.holder === p.i
      ? `<span class="bontag${S.bonbi.form !== "normal" ? " king" : ""}">${BONBI_LABEL[S.bonbi.form]}</span>`
      : "";
    row.innerHTML = `<div class="rk">${i + 1}</div>
      <div class="nm"><span class="chipdot" style="background:${p.color}"></span>${p.name}${p.human ? "" : " (CPU)"} ${bon}</div>
      <div class="total">${fmtMoney(totalAssets(p))}</div>
      <div class="sub">持ち金 ${fmtMoney(p.cash)} ・ 札${p.cards.length}</div>`;
    row.onclick = () => showAssets(p);
    ranking.appendChild(row);
  });
}

export function updateDock(): void {
  const p = S.players[S.turn];
  if (!p) return;
  const hand = $("hand");
  hand.innerHTML = "";
  const hp = S.players.find((q) => q.human);
  if (hp) {
    hp.cards.forEach((cid, idx) => {
      const c = CARDS[cid];
      const bt = document.createElement("button");
      bt.className = "cardchip" + (c.kind === "passive" ? " passive" : "");
      bt.innerHTML = `${c.n}<small>${c.d}</small>`;
      bt.onclick = () => { if (c.kind !== "passive") resolveAction({ kind: "card", idx }); };
      hand.appendChild(bt);
    });
  }
}

export function updateAll(): void {
  updateHUD();
  updateRanking();
  updateDock();
  updateOwnDots();
  drawTokens();
  drawDest();
  drawDrops();
}

export function showCityInfo(ci: number): void {
  const rows = CITIES[ci][3].map((pr, pi) => {
    const o = S.propOwner.length ? S.propOwner[ci][pi] : -1;
    return `<tr><td>${pr[0]}</td><td class="num">${fmtMoney(pr[1])}</td><td class="num">${pr[2]}%</td><td>${ownerTag(o)}</td></tr>`;
  }).join("");
  const owners = S.propOwner.length ? propOwners(ci) : [];
  const mono = owners.length > 0 && owners[0] >= 0 && owners.every((o) => o === owners[0]);
  void modal({
    title: `${CITIES[ci][0]}駅の物件じょうほう`,
    html: `${mono ? `<p><b style="color:#B07E12">★${S.players[owners[0]].name}が独占中!(収益2倍)</b></p>` : ""}
     <table class="props"><tr><th>物件</th><th style="text-align:right">価格</th><th style="text-align:right">収益率</th><th>持ち主</th></tr>${rows}</table>
     <p class="rulenote" style="margin-top:8px">この駅に止まると、売り物件を買えるよ。</p>`,
  });
}

export async function showAssets(p: Player): Promise<void> {
  let rows = "";
  for (let ci = 0; ci < CITIES.length; ci++) {
    const owned = CITIES[ci][3].map((pr, pi) => ({ pr, pi })).filter((x) => S.propOwner[ci][x.pi] === p.i);
    if (!owned.length) continue;
    const mono = isMonopoly(ci, p.i);
    rows += `<tr><td colspan="3" style="border-top:2px solid var(--ink)"><b>${CITIES[ci][0]}</b>${mono ? ' <span style="color:#B07E12">★独占(収益2倍)</span>' : ""}</td></tr>`;
    owned.forEach(({ pr }) => {
      const inc = Math.round((pr[1] * pr[2]) / 100 * (mono ? 2 : 1));
      rows += `<tr><td>${pr[0]}</td><td class="num">${fmtMoney(pr[1])}</td><td class="num">年 ${fmtMoney(inc)}</td></tr>`;
    });
  }
  await modal({
    title: `${p.name}の資産`,
    html: `<p>持ち金 <b>${fmtMoney(p.cash)}</b> / 物件 <b>${fmtMoney(propValue(p.i))}</b> / 総資産 <b>${fmtMoney(totalAssets(p))}</b></p>
     <p>決算の予想収益:<b>${fmtMoney(playerIncome(p.i))}</b></p>
     <table class="props">${rows || '<tr><td>物件はまだ持っていません</td></tr>'}</table>`,
  });
}

export function showHowto(): Promise<boolean> {
  return modal<boolean>({
    title: "あそびかた(はじめての人向け)", headKlass: "gold", html: `<div class="howto">
    <p><b>キミは鉄道会社の社長!</b>サイコロで日本中をめぐって物件を買い集め、決めた年数がおわったときに<b>総資産(現金+物件)がいちばん多い人が優勝</b>だ。</p>
    <p><b>1. サイコロをふる</b><br>自分の番が来たら「サイコロ!」ボタン。出た目のぶん進む。分かれ道では光っているマスをタップして進む方向をえらぶ(<b style="color:var(--accent)">赤いリング</b>が目的地への近道。「あと◯マス」も表示)。自分のコマには黄色い▼マークがつく。</p>
    <p><b>2. 目的地をめざす</b><br>目的地の駅にいちばん早く着くと<b>援助金</b>がもらえる。着いたら次の目的地が決まる。目的地が画面の外にあるときは、画面のはしに<b style="color:var(--accent)">赤い方向矢印</b>が出る。</p>
    <p><b>3. 物件を買う</b><br>駅に止まるとその街の物件が買える。物件は毎年3月の<b>決算</b>で収益を生む資産。街の物件を全部買うと<b>独占で収益2倍</b>!持ち金がマイナスだと決算で利子10%がつくので注意。駅名標はいつでもタップして物件と持ち主を確認できる。</p>
    <p><b>4. 貧乏神に注意</b><br>だれかが目的地に着いたとき、いちばん遠かった人に貧乏神がとりつく。放っておくと<b>キングボンビー・ボンビーJr.ポコン・ビッグボンビー</b>、さらには<b>デストロイ号</b>に変身して大あばれ!同じマスのだれかになすりつけるか、おはらいカードで追いはらおう。</p>
    <p><b>マスの色</b>:<b style="color:var(--blue)">青(+)</b>=お金がもらえる / <b style="color:var(--accent)">赤(−)</b>=お金をはらう / <b style="color:#B07E12">C</b>=カード / <b style="color:var(--purple)">宝</b>=宝くじ / <b style="color:#25AFA5">W</b>=ワープ</p>
    <p><b>カード</b>は移動が速くなる急行・特急・のぞみ、相手を足止めする<b>牛歩カード</b>など9種類。ポコンに吹き飛ばされた物件は金色マークの駅に落ちていて、<b>通るだけでタダで拾える</b>!</p>
    <p>ときどき駅で<b>歴史ヒーロー</b>や<b>名産怪獣</b>に出会えることも…!</p>
  </div>`,
  });
}
