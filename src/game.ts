import type { CardId, HeroDef, Player, UseCardResult } from "./types";
import { CITIES, CARDS, KAIJU, PCOLORS, CPU_NAMES, HAND_MAX } from "./data";
import { G, distsFrom, bfsDist, FY, cityName } from "./geo";
import {
  S, rnd, pick, sleep, fmtMoney, yearOf, yearMult, currentPrize,
  propOwners, isMonopoly, playerIncome, propValue, totalAssets,
} from "./state";
import { SND } from "./sound";
import { $, log, banner, hideBanner, modal, updateAll, ownerTag } from "./ui";
import { camTo, focusPlayer, drawTokens, checkDrop, highlightOptions, setFullView } from "./render";
import { waitAction } from "./input";

/* ================= 歴史ヒーロー ================= */
const HEROES: Record<string, HeroDef> = {
  "札幌": { n: "クラーク博士", msg: "少年よ、大志をいだけ!", f: async (p) => { giveCard(p, "nozomi"); } },
  "仙台": { n: "伊達政宗", msg: "この街の発展、そちにも分けてやろう", f: async (p) => { gainMoney(p, Math.round((500 + rnd(500)) * yearMult()), "政宗公からの軍資金!"); } },
  "京都": { n: "紫式部", msg: "あなたの旅を、物語に書きとめました", f: async (p) => { gainMoney(p, Math.round((400 + rnd(400)) * yearMult()), "物語のお礼!"); } },
  "名古屋": {
    n: "織田信長", msg: "泣かぬなら 泣かせてみせよう 貧乏神", f: async (p) => {
      if (S.bonbi.holder === p.i) {
        S.bonbi.holder = -1; S.bonbi.form = "normal";
        log("織田信長が貧乏神を斬り捨てた!", "money");
        banner("信長が貧乏神を追い払った!", "good");
      } else gainMoney(p, Math.round(500 * yearMult()), "信長からの軍資金!");
    },
  },
  "高知": { n: "坂本龍馬", msg: "日本の夜明けぜよ!ぶっとんでいきや!", f: async (p) => { giveCard(p, "buttobi"); } },
  "鹿児島": { n: "西郷どん", msg: "おいどんが守っちゃる", f: async (p) => { giveCard(p, "shield"); } },
};

/* ================= 目的地・移動 ================= */
export function newDest(exclude: number): void {
  const d = distsFrom(exclude);
  const ids = Object.values(G.cityIdx);
  let cands = ids.filter((id) => id !== exclude && d[id] >= 8 && d[id] <= 24);
  if (!cands.length) cands = ids.filter((id) => id !== exclude && d[id] >= 8);
  if (!cands.length) cands = ids.filter((id) => id !== exclude);
  S.dest = pick(cands);
}

const DICE_ROT: Record<number, [number, number]> = {
  1: [0, 0], 2: [0, -90], 3: [0, 180], 4: [0, 90], 5: [-90, 0], 6: [90, 0],
};
async function showDice(rolls: number[]): Promise<void> {
  const dv = $("diceview");
  dv.innerHTML = "";
  SND.dice();
  const cubes = rolls.map(() => {
    const d = document.createElement("div"); d.className = "die";
    const c = document.createElement("div"); c.className = "cube";
    for (let f = 1; f <= 6; f++) {
      const fa = document.createElement("div");
      fa.className = `f f${f}`; fa.textContent = String(f);
      c.appendChild(fa);
    }
    c.style.transform = "rotateX(-30deg) rotateY(40deg)";
    d.appendChild(c); dv.appendChild(d);
    return c;
  });
  await sleep(60);
  cubes.forEach((c, i) => {
    const [rx, ry] = DICE_ROT[rolls[i]];
    c.style.transform = `rotateX(${rx + 720}deg) rotateY(${ry - 720}deg)`;
  });
  await sleep(750);
}

function chooseCpuStep(opts: number[], target: number): number {
  const dt = distsFrom(target);
  let best = opts[0], bd = Infinity;
  for (const o of opts) { if (dt[o] >= 0 && dt[o] < bd) { bd = dt[o]; best = o; } }
  return best;
}

async function chooseHumanStep(opts: number[]): Promise<number> {
  banner("すすむ方向をえらんでね(赤いリング=目的地への近道)", "", true);
  const next = await highlightOptions(opts);
  hideBanner();
  return next;
}

async function moveBy(p: Player, steps: number): Promise<void> {
  const target = S.bonbi.holder === p.i ? nearestOther(p) : S.dest;
  for (let s = 0; s < steps; s++) {
    let opts = G.adj[p.pos].filter((n) => n !== p.prev);
    if (!opts.length) opts = [p.prev];
    let next: number;
    if (opts.length === 1) next = opts[0];
    else next = p.human ? await chooseHumanStep(opts) : chooseCpuStep(opts, target);
    p.prev = p.pos; p.pos = next;
    SND.tick(); drawTokens(); focusPlayer(p);
    checkDrop(p);
    await sleep(230);
    if (next === S.dest) { await arrive(p); return; }
  }
  await landEffect(p);
}

function nearestOther(p: Player): number {
  const d = distsFrom(p.pos);
  let best = -1, bd = Infinity;
  for (const q of S.players) if (q.i !== p.i && d[q.pos] >= 0 && d[q.pos] < bd) { bd = d[q.pos]; best = q.pos; }
  return best < 0 ? S.dest : best;
}

function gainMoney(p: Player, amt: number, msg: string): void {
  p.cash += amt;
  log(`${p.name}:${msg} ${amt >= 0 ? "+" : ""}${fmtMoney(amt)}`, amt >= 0 ? "money" : "bad");
  (amt >= 0 ? SND.coin : SND.bad)();
  banner(`${msg} ${amt >= 0 ? "+" : ""}${fmtMoney(amt)}`, amt >= 0 ? "good" : "warn");
}

function giveCard(p: Player, cid: CardId): boolean {
  if (p.cards.length >= HAND_MAX) { log(`${p.name}:カードがいっぱいで もらえなかった…`, "sys"); return false; }
  p.cards.push(cid);
  SND.card();
  log(`${p.name}:${CARDS[cid].n}を手に入れた!`);
  banner(`${CARDS[cid].n}を手に入れた!`);
  return true;
}

function randomCard(): CardId {
  const ids = Object.keys(CARDS) as CardId[];
  const total = ids.reduce((s, id) => s + CARDS[id].w, 0);
  let r = Math.random() * total;
  for (const id of ids) { r -= CARDS[id].w; if (r <= 0) return id; }
  return "kyuko";
}

async function landEffect(p: Player): Promise<void> {
  const n = G.nodes[p.pos];
  await sleep(150);
  if (n.type === "city") { await cityStop(p, n); return; }
  if (n.type === "blue") { gainMoney(p, Math.round((80 + rnd(280)) * yearMult()), "プラス駅!臨時収入"); }
  else if (n.type === "red") { gainMoney(p, -Math.round((80 + rnd(280)) * yearMult()), "マイナス駅…出費だ"); }
  else if (n.type === "card") { giveCard(p, randomCard()); }
  else if (n.type === "lotto") {
    const r = Math.random();
    let amt = 0, label = "はずれ…";
    if (r > 0.99) { amt = 10000; label = "超大当たり!!1等!"; }
    else if (r > 0.95) { amt = 3000; label = "大当たり!2等!"; }
    else if (r > 0.85) { amt = 1000; label = "当たり!3等!"; }
    else if (r > 0.65) { amt = 400; label = "小当たり!"; }
    log(`${p.name}:宝くじ駅で抽選…${label}`);
    if (amt > 0) { await sleep(300); gainMoney(p, Math.round(amt * yearMult()), `宝くじ ${label}`); }
    else { banner("宝くじ…はずれ", "warn"); SND.bad(); }
  } else if (n.type === "warp") {
    banner("ワープ駅!どこかへ飛ばされる!", "warn");
    SND.card();
    await sleep(600);
    const cid = pick(Object.values(G.cityIdx).filter((i) => i !== S.dest && i !== p.pos));
    p.pos = cid; p.prev = -1;
    drawTokens(); focusPlayer(p);
    checkDrop(p);
    log(`${p.name}:ワープ駅で${cityName(cid)}へ飛ばされた!`);
    await sleep(400);
    const target = G.nodes[cid];
    if (target.type === "city") await cityStop(p, target);
  }
  updateAll();
}

async function cityStop(p: Player, n: Extract<typeof G.nodes[number], { type: "city" }>): Promise<void> {
  const ci = n.ci;
  const hero = HEROES[n.name];
  if (hero && Math.random() < 0.35) {
    SND.fanfare();
    await modal({ title: "歴史ヒーロー登場!", headKlass: "gold", html: `<p><b>${hero.n}</b>があらわれた!</p><p>「${hero.msg}」</p>` });
    await hero.f(p);
    updateAll();
  }
  const kj = KAIJU[n.name];
  if (kj && Math.random() < 0.25) {
    if (Math.random() < 0.5) {
      SND.fanfare();
      await modal({ title: `${kj}あらわる!`, headKlass: "gold", html: `<p><b>${kj}</b>が${p.name}になついた!</p><p>名産品をどっさり分けてくれた!</p>` });
      gainMoney(p, Math.round((300 + rnd(400)) * yearMult()), `${kj}のおすそわけ!`);
    } else {
      SND.bad();
      await modal({ title: `${kj}あらわる!`, headKlass: "evil", html: `<p><b>${kj}</b>が大あばれ!</p><p>${p.name}は巻きこまれてしまった…</p>` });
      gainMoney(p, -Math.round((200 + rnd(400)) * yearMult()), `${kj}が大あばれ…`);
    }
    updateAll();
  }
  const buyable = CITIES[ci][3].map((pr, pi) => ({ pr, pi })).filter((x) => S.propOwner[ci][x.pi] < 0);
  if (!buyable.length) { log(`${p.name}:${n.name}に停車(売り物件なし)`, "sys"); return; }
  if (p.human) { await buyDialog(p, ci); }
  else {
    const bought: string[] = [];
    const sorted = [...buyable].sort((a, b) => a.pr[1] - b.pr[1]);
    for (const { pr, pi } of sorted) {
      const wantMono = propOwners(ci).filter((o) => o === p.i).length === CITIES[ci][3].length - 1;
      const reserve = wantMono ? 0 : 300;
      if (p.cash - pr[1] >= reserve) { p.cash -= pr[1]; S.propOwner[ci][pi] = p.i; bought.push(pr[0]); }
    }
    if (bought.length) {
      SND.coin();
      log(`${p.name}:${n.name}で ${bought.join("、")} を購入!`);
      banner(`${p.name}が${n.name}で物件を購入!`);
      if (isMonopoly(ci, p.i)) {
        log(`${p.name}:${n.name}を独占!収益2倍!!`, "money");
        banner(`${p.name}が${n.name}を独占!!`, "warn");
        SND.fanfare();
      }
      await sleep(600);
    }
  }
  updateAll();
}

async function buyDialog(p: Player, ci: number): Promise<void> {
  for (;;) {
    const props = CITIES[ci][3];
    const rows = props.map((pr, pi) => {
      const o = S.propOwner[ci][pi];
      const can = o < 0 && p.cash >= pr[1];
      return `<tr><td>${pr[0]}</td><td class="num">${fmtMoney(pr[1])}</td><td class="num">${pr[2]}%</td>
        <td>${o < 0 ? `<button class="mbtn buy" data-pi="${pi}" ${can ? "" : "disabled"}>買う</button>` : ownerTag(o)}</td></tr>`;
    }).join("");
    const choice = await new Promise<number>((res) => {
      const ov = $("overlay");
      ov.innerHTML = "";
      const m = document.createElement("div"); m.className = "modal";
      m.innerHTML = `<header class="gold">${CITIES[ci][0]}駅 物件案内</header>
        <div class="body"><p>持ち金:<b>${fmtMoney(p.cash)}</b> ${isMonopoly(ci, p.i) ? '<b style="color:#B07E12">★この街を独占中!</b>' : ""}</p>
        <table class="props"><tr><th>物件</th><th style="text-align:right">価格</th><th style="text-align:right">収益率</th><th></th></tr>${rows}</table></div>
        <div class="btns"><button class="mbtn" id="buyclose">やめる</button></div>`;
      m.querySelectorAll<HTMLButtonElement>(".buy").forEach((bt) => {
        bt.onclick = () => { ov.classList.remove("show"); ov.innerHTML = ""; res(Number(bt.dataset.pi)); };
      });
      (m.querySelector("#buyclose") as HTMLButtonElement).onclick = () => { ov.classList.remove("show"); ov.innerHTML = ""; res(-1); };
      ov.appendChild(m); ov.classList.add("show");
    });
    if (choice < 0) break;
    const pr = CITIES[ci][3][choice];
    p.cash -= pr[1]; S.propOwner[ci][choice] = p.i;
    SND.coin();
    log(`${p.name}:${CITIES[ci][0]}の${pr[0]}を購入!(${fmtMoney(pr[1])})`, "money");
    if (isMonopoly(ci, p.i)) {
      SND.fanfare();
      log(`${p.name}:${CITIES[ci][0]}を独占!収益2倍!!`, "money");
      await modal({ title: "独占!!", headKlass: "gold", html: `<p class="bignum gold">${CITIES[ci][0]}を独占!</p><p>この街の物件収益が<b>2倍</b>になった!</p>` });
    }
    updateAll();
  }
}

async function arrive(p: Player): Promise<void> {
  drawTokens();
  const prize = currentPrize();
  p.cash += prize; S.arrivals++;
  SND.fanfare();
  log(`${p.name}:目的地 ${cityName(S.dest)} に一番乗り!援助金${fmtMoney(prize)}!`, "money");
  await modal({
    title: "目的地とうちゃく!", headKlass: "gold",
    html: `<p><b>${p.name}</b>が <b>${cityName(S.dest)}</b> に一番乗り!</p><p class="bignum gold">援助金 ${fmtMoney(prize)}</p>`,
  });
  const old = S.dest;
  newDest(old);
  // 貧乏神:新目的地からいちばん遠いプレイヤーに憑依
  const others = S.players.filter((q) => q.i !== p.i);
  if (others.length) {
    const d = distsFrom(old);
    let far = others[0];
    for (const q of others) if (d[q.pos] > d[far.pos]) far = q;
    await attachBonbi(far);
  }
  banner(`つぎの目的地は ${cityName(S.dest)}!`, "good");
  log(`つぎの目的地は ${cityName(S.dest)} にきまった!`, "sys");
  const dn = G.nodes[S.dest];
  camTo(dn.x, FY(dn.y), 500);
  await sleep(900);
  updateAll();
}

async function attachBonbi(q: Player): Promise<void> {
  const shieldIdx = q.cards.indexOf("shield");
  if (shieldIdx >= 0) {
    q.cards.splice(shieldIdx, 1);
    log(`${q.name}:シールドカードが貧乏神をはじいた!`, "money");
    banner(`${q.name}のシールドが貧乏神をブロック!`, "good");
    SND.card();
    return;
  }
  S.bonbi = { holder: q.i, form: "normal", turns: 0 };
  SND.bonbi();
  await modal({
    title: "貧乏神があらわれた!", headKlass: "evil",
    html: `<p>ビリだった <b>${q.name}</b> に<br><b style="font-size:20px">貧乏神</b>がとりついた…!</p><p>毎ターンわるさをするぞ。だれかに なすりつけろ!</p>`,
  });
  log(`${q.name}に貧乏神がとりついた…!`, "bad");
  updateAll();
}

async function bonbiPhase(p: Player): Promise<void> {
  const B = S.bonbi;
  if (B.holder < 0) return;
  const holder = S.players[B.holder];
  // なすりつけ(同じマスにいる相手へ)
  if (p.i !== B.holder && p.pos === holder.pos) { await transferBonbi(p); return; }
  if (p.i === B.holder) {
    const targets = S.players.filter((q) => q.i !== p.i && q.pos === p.pos);
    if (targets.length) { await transferBonbi(pick(targets)); return; }
    await mischief(p);
  }
}

async function transferBonbi(to: Player): Promise<void> {
  const shieldIdx = to.cards.indexOf("shield");
  if (shieldIdx >= 0) {
    to.cards.splice(shieldIdx, 1);
    log(`${to.name}:シールドカードが貧乏神をはじいた!`, "money");
    banner(`${to.name}のシールドが貧乏神をブロック!`, "good");
    return;
  }
  const from = S.players[S.bonbi.holder];
  S.bonbi.holder = to.i; S.bonbi.turns = 0;
  SND.bonbi();
  log(`貧乏神が${from.name}から${to.name}になすりつけられた!`, "bad");
  banner(`貧乏神が${to.name}にのりうつった!`, "warn");
  await sleep(700);
  updateAll();
}

function ownedProps(pl: number) {
  const owned: { ci: number; pi: number; pr: (typeof CITIES)[number][3][number] }[] = [];
  for (let ci = 0; ci < CITIES.length; ci++) {
    CITIES[ci][3].forEach((pr, pi) => { if (S.propOwner[ci][pi] === pl) owned.push({ ci, pi, pr }); });
  }
  return owned;
}

async function destroyProp(p: Player, who: string): Promise<boolean> {
  const owned = ownedProps(p.i);
  if (!owned.length) return false;
  const t = pick(owned);
  S.propOwner[t.ci][t.pi] = -1;
  SND.king();
  log(`${who}:${p.name}の「${CITIES[t.ci][0]}の${t.pr[0]}」を破壊した!!`, "bad");
  await modal({
    title: `${who}のわるさ`, headKlass: "evil",
    html: `<p><b>${CITIES[t.ci][0]}の${t.pr[0]}</b>(${fmtMoney(t.pr[1])})が<br><b style="color:var(--accent)">こなごなに破壊された!!</b></p>`,
  });
  return true;
}

async function mischief(p: Player): Promise<void> {
  const B = S.bonbi, ym = yearMult();
  await sleep(400);
  if (B.form === "king") {
    if (Math.random() < 0.4) {
      if (!(await destroyProp(p, "キングボンビー"))) {
        gainMoney(p, -Math.round((1200 + rnd(2800)) * ym), "キングボンビーがお金をばらまいた!!");
      }
    } else {
      SND.king();
      gainMoney(p, -Math.round((1200 + rnd(2800)) * ym), "キングボンビーの豪遊!!");
    }
  } else if (B.form === "destroy") {
    SND.king();
    let broke = 0;
    for (let k = 0; k < 2; k++) if (await destroyProp(p, "デストロイ号")) broke++;
    const amt = Math.round((2000 + rnd(4000)) * ym);
    gainMoney(p, -amt, "デストロイ号の破壊光線!!");
    if (!broke) log("デストロイ号:破壊する物件がなくて お金だけ焼きはらった…", "bad");
  } else if (B.form === "pokon") {
    const owned = ownedProps(p.i);
    if (owned.length) {
      const cnt = Math.min(owned.length, 1 + rnd(2));
      const d = distsFrom(p.pos);
      const cand = G.nodes.map((_, i) => i).filter((i) => d[i] >= 2 && d[i] <= 8 && i !== S.dest);
      const names: string[] = [];
      for (let k = 0; k < cnt; k++) {
        const idx = rnd(owned.length);
        const t = owned.splice(idx, 1)[0];
        S.propOwner[t.ci][t.pi] = -1;
        const spot = pick(cand);
        (S.drops[spot] ??= []).push({ prop: t });
        names.push(`${CITIES[t.ci][0]}の${t.pr[0]}`);
      }
      SND.bad();
      log(`ポコン:${p.name}の物件「${names.join("、")}」を吹き飛ばした!近くの駅に落ちている…`, "bad");
      await modal({
        title: "ボンビーJr.ポコンのいたずら", headKlass: "evil",
        html: `<p><b>${names.join("」「")}</b>が<br><b style="color:var(--accent)">ポコーン!と吹き飛ばされた!!</b></p><p>近くの駅に落ちている。だれでも拾えるぞ…!(金色のマーク)</p>`,
      });
    } else {
      gainMoney(p, -Math.round((200 + rnd(500)) * ym), "ポコンがだだをこねて出費…");
    }
  } else if (B.form === "big") {
    const n = 1 + rnd(6);
    SND.bad();
    if (p.cash < 0) {
      const before = p.cash;
      p.cash = Math.round(p.cash * (1 + n * 0.15));
      log(`ビッグボンビー:サイコロの目は${n}!${p.name}の借金が${fmtMoney(p.cash - before)}ふくらんだ!!`, "bad");
      await modal({
        title: "ビッグボンビーの悪行", headKlass: "evil",
        html: `<p>ビッグボンビーがサイコロをふった…出た目は<b>${n}</b>!</p><p class="bignum bad">借金が ${n * 15}% 増えた!!</p><p>持ち金:${fmtMoney(p.cash)}</p>`,
      });
    } else {
      gainMoney(p, -Math.round((n * 150 + rnd(300)) * ym), `ビッグボンビーのサイコロ(${n})で大出費…`);
    }
  } else {
    const r = Math.random();
    if (r < 0.2 && p.cards.length) {
      const idx = rnd(p.cards.length);
      const cid = p.cards.splice(idx, 1)[0];
      SND.bad();
      log(`貧乏神:${p.name}の${CARDS[cid].n}を線路に捨てた…`, "bad");
      banner(`貧乏神が${CARDS[cid].n}を捨てた…`, "warn");
    } else if (r < 0.38) {
      p.slow = (p.slow || 0) + 1;
      SND.bad();
      log(`貧乏神:${p.name}にしがみついて足止め!つぎのサイコロは1だ…`, "bad");
      banner("貧乏神が足止めしてきた!", "warn");
    } else if (r < 0.9) {
      gainMoney(p, -Math.round((100 + rnd(450)) * ym), "貧乏神のむだづかい…");
    } else {
      log("貧乏神:きょうは ひるねをしている…", "sys");
      banner("貧乏神はひるね中…", "");
    }
  }
  B.turns++;
  if (B.form === "normal" && B.turns >= 2 && Math.random() < 0.22) {
    const r = Math.random();
    B.form = r < 0.4 ? "king" : r < 0.7 ? "pokon" : "big";
    SND.king();
    const desc = { king: "わるさが超凶悪になるぞ…!", pokon: "パパよりめいわく!?物件が吹き飛ばされるぞ…!", big: "借金がどんどんふくらむぞ…!" }[B.form];
    await modal({
      title: "!!!!", headKlass: "evil",
      html: `<p style="text-align:center" class="bignum bad">${{ king: "キングボンビー", pokon: "ボンビーJr.ポコン", big: "ビッグボンビー" }[B.form]}が誕生!!</p><p>貧乏神が変身した!${desc}<br>いそいで だれかに なすりつけろ!!</p>`,
    });
    log(`貧乏神が${{ king: "キングボンビー", pokon: "ボンビーJr.ポコン", big: "ビッグボンビー" }[B.form]}に変身した!!`, "bad");
  } else if (B.form === "king" && B.turns >= 4 && yearOf() * 2 >= S.years && Math.random() < 0.2) {
    B.form = "destroy";
    SND.king();
    await modal({
      title: "!!!!!!", headKlass: "evil",
      html: `<p style="text-align:center" class="bignum bad">デストロイ号 発進!!</p><p>キングボンビーが最凶形態に変身した!<br>物件もお金も まとめて破壊されるぞ…!!</p>`,
    });
    log("キングボンビーがデストロイ号に変身した!!", "bad");
  }
  updateAll();
}

/* ---------- cards ---------- */
async function useCard(p: Player, idx: number): Promise<UseCardResult> {
  const cid = p.cards[idx], c = CARDS[cid];
  if (c.kind === "move") {
    p.cards.splice(idx, 1);
    log(`${p.name}:${c.n}を使った!`); banner(`${c.n}!`); SND.card();
    return { dice: c.dice as number };
  }
  if (c.kind === "warp") {
    p.cards.splice(idx, 1);
    SND.card();
    log(`${p.name}:ぶっとびカードを使った!`);
    banner("ぶっとび〜〜!", "warn");
    await sleep(600);
    const cid2 = pick(Object.values(G.cityIdx).filter((i) => i !== p.pos));
    p.pos = cid2; p.prev = -1;
    drawTokens(); focusPlayer(p);
    checkDrop(p);
    await sleep(500);
    if (cid2 === S.dest) { await arrive(p); } else {
      const target = G.nodes[cid2];
      if (target.type === "city") await cityStop(p, target);
    }
    return { done: true };
  }
  if (c.kind === "money") {
    p.cards.splice(idx, 1);
    gainMoney(p, Math.round((200 + rnd(600)) * yearMult()), "福袋カード!");
    return null;
  }
  if (c.kind === "slow") {
    p.cards.splice(idx, 1);
    const t = pick(S.players.filter((q) => q.i !== p.i));
    t.slow = (t.slow || 0) + 2;
    SND.card();
    log(`${p.name}:牛歩カード!${t.name}を足止めした!`);
    banner(`${t.name}は2ターンのあいだサイコロが1に…!`, "warn");
    await sleep(500);
    return null;
  }
  if (c.kind === "ohara") {
    if (S.bonbi.holder !== p.i) { banner("貧乏神がついていないと使えないよ", "warn"); return null; }
    p.cards.splice(idx, 1);
    S.bonbi.holder = -1; S.bonbi.form = "normal";
    SND.fanfare();
    log(`${p.name}:おはらいカードで貧乏神を追いはらった!`, "money");
    await modal({ title: "おはらい成功!", headKlass: "gold", html: "<p>貧乏神は とおくへ 飛んでいった…!</p>" });
    updateAll();
    return null;
  }
  if (c.kind === "throw") {
    if (S.bonbi.holder !== p.i) { banner("貧乏神がついていないと使えないよ", "warn"); return null; }
    p.cards.splice(idx, 1);
    const t = pick(S.players.filter((q) => q.i !== p.i));
    log(`${p.name}:豪速球カード!貧乏神をぶん投げた!`);
    banner("豪速球〜〜!!", "warn");
    SND.card();
    await sleep(700);
    await transferBonbi(t);
    return null;
  }
  return null;
}

type CpuAction = { roll: true } | { roll?: undefined; card: number };

function cpuPreRoll(p: Player): CpuAction {
  // 貧乏神対応
  if (S.bonbi.holder === p.i) {
    let i = p.cards.indexOf("ohara"); if (i >= 0) return { card: i };
    i = p.cards.indexOf("gosoku"); if (i >= 0) return { card: i };
  }
  const d = bfsDist(p.pos, S.dest);
  const tryCards: CardId[] = ["nozomi", "tokkyu", "kyuko"];
  if (d >= 9 && Math.random() < 0.65) {
    for (const cid of tryCards) { const i = p.cards.indexOf(cid); if (i >= 0) return { card: i }; }
  }
  const f = p.cards.indexOf("fuku");
  if (f >= 0 && Math.random() < 0.5) return { card: f };
  const u = p.cards.indexOf("ushiho");
  if (u >= 0 && Math.random() < 0.35) return { card: u };
  return { roll: true };
}

/* ---------- turn ---------- */
async function doTurn(p: Player): Promise<void> {
  updateAll(); focusPlayer(p);
  banner(`${p.name}のばん!`, "");
  await sleep(500);
  let diceCount = 1, done = false;
  if (p.human) {
    $<HTMLButtonElement>("dicebtn").disabled = false;
    for (;;) {
      const a = await waitAction();
      if (a.kind === "roll") { diceCount = 1; break; }
      const res = await useCard(p, a.idx);
      updateAll();
      if (res && "done" in res) { done = true; break; }
      if (res && "dice" in res) { diceCount = res.dice; break; }
      $<HTMLButtonElement>("dicebtn").disabled = false;
    }
    $<HTMLButtonElement>("dicebtn").disabled = true;
  } else {
    await sleep(400);
    let guard = 0;
    while (guard++ < 4) {
      const act = cpuPreRoll(p);
      if (act.roll) { diceCount = 1; break; }
      const res = await useCard(p, act.card);
      updateAll();
      if (res && "done" in res) { done = true; break; }
      if (res && "dice" in res) { diceCount = res.dice; break; }
    }
  }
  if (!done) {
    let rolls = Array.from({ length: diceCount }, () => 1 + rnd(6));
    if (p.slow > 0) {
      p.slow--;
      rolls = [1];
      banner(`${p.name}は足止め中…サイコロは1!`, "warn");
      log(`${p.name}:足止めされていてサイコロが1しか出ない…`, "bad");
    }
    await showDice(rolls);
    const total = rolls.reduce((a, b) => a + b, 0);
    log(`${p.name}:サイコロは ${rolls.join("・")} → ${total}マス進む`, "sys");
    await moveBy(p, total);
  }
  $("diceview").innerHTML = "";
  await bonbiPhase(p);
  updateAll();
  await sleep(350);
}

async function settlement(): Promise<void> {
  SND.fanfare();
  let rows = "";
  for (const p of S.players) {
    const inc = playerIncome(p.i);
    let interest = 0;
    if (p.cash < 0) interest = Math.round(p.cash * 0.1);
    p.cash += inc + interest;
    rows += `<tr><td><span class="chipdot" style="background:${p.color}"></span> ${p.name}</td>
      <td class="num" style="color:#2E7D4F">+${fmtMoney(inc)}</td>
      <td class="num" style="color:var(--accent)">${interest ? fmtMoney(interest) : "—"}</td>
      <td class="num"><b>${fmtMoney(p.cash)}</b></td></tr>`;
    log(`決算:${p.name} 収益+${fmtMoney(inc)}${interest ? ` 借金利子${fmtMoney(interest)}` : ""}`, "money");
  }
  await modal({
    title: `${yearOf()}年目 3月 けっさん!`, headKlass: "gold",
    html: `<table class="props"><tr><th>プレイヤー</th><th style="text-align:right">物件収益</th><th style="text-align:right">借金利子</th><th style="text-align:right">持ち金</th></tr>${rows}</table>
    <p style="margin-top:8px" class="rulenote">物件の収益は 価格×収益率。独占した街は2倍!持ち金がマイナスだと利子10%がのしかかる…</p>`,
  });
  updateAll();
}

async function finale(): Promise<void> {
  S.over = true;
  SND.win();
  const list = [...S.players].sort((a, b) => totalAssets(b) - totalAssets(a));
  const ov = $("overlay");
  ov.innerHTML = "";
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<header class="gold">結果はっぴょう!(${S.years}年の旅)</header><div class="body" id="finbody"></div>
    <div class="btns"><button class="mbtn primary" id="againbtn">もういちど遊ぶ</button></div>`;
  ov.appendChild(m); ov.classList.add("show");
  const body = m.querySelector("#finbody") as HTMLElement;
  const rows = list.map((p, i) => {
    const r = document.createElement("div");
    r.className = "finrow" + (i === 0 ? " first" : "");
    r.innerHTML = `<div class="frk">${i + 1}位</div>
      <div><div class="fnm"><span class="chipdot" style="background:${p.color}"></span>${p.name}${p.human ? "" : " (CPU)"}</div>
      <div class="fsub">持ち金 ${fmtMoney(p.cash)} ・ 物件 ${fmtMoney(propValue(p.i))}</div></div>
      <div class="fassets">${fmtMoney(totalAssets(p))}</div>`;
    body.appendChild(r);
    return r;
  });
  (m.querySelector("#againbtn") as HTMLButtonElement).onclick = () => location.reload();
  for (let i = rows.length - 1; i >= 0; i--) {
    await sleep(800);
    rows[i].classList.add("reveal");
    if (i === 0) SND.fanfare(); else SND.tick();
  }
  const winner = list[0];
  log(`ゲーム終了!優勝は ${winner.name}(総資産 ${fmtMoney(totalAssets(winner))})!`, "money");
}

export async function gameLoop(): Promise<void> {
  while (!S.over) {
    const p = S.players[S.turn];
    await doTurn(p);
    if (S.over) break;
    S.turn = (S.turn + 1) % S.players.length;
    if (S.turn === 0) {
      const isMarch = S.monthIdx % 12 === 11;
      if (isMarch) {
        await settlement();
        if (S.monthIdx === S.years * 12 - 1) { await finale(); return; }
      }
      S.monthIdx++;
    }
    updateAll();
  }
}

export function startNewGame(name: string, years: number, speed: number, ncpu: number): void {
  S.years = years;
  S.speed = speed;
  S.turn = 0;
  S.monthIdx = 0;
  S.arrivals = 0;
  S.over = false;
  S.bonbi = { holder: -1, form: "normal", turns: 0 };
  S.drops = {};
  S.propOwner = CITIES.map((c) => c[3].map(() => -1));
  const start = G.cityIdx["東京"];
  S.players = [{ i: 0, name, human: true, color: PCOLORS[0], cash: 1000, cards: ["kyuko"], pos: start, prev: -1, slow: 0 }];
  for (let k = 0; k < ncpu; k++) {
    S.players.push({ i: k + 1, name: CPU_NAMES[k], human: false, color: PCOLORS[k + 1], cash: 1000, cards: ["kyuko"], pos: start, prev: -1, slow: 0 });
  }
  newDest(start);
  setFullView(false);
}
