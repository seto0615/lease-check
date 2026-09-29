import { ROLES, NODES, RESULTS, CONTRACTS, PERSPECTIVES, DICT_PROMPT, IFRS_DIFF } from './data.js';
import { schedule, yen, parseNum } from './calc.js';

// ── 保存（端末ごとの localStorage。使えない環境でも動くように握りつぶす） ──
const KEY = 'leasecheck:v1';
const store = (() => {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  return {
    get: (k, def) => (k in d ? d[k] : def),
    set: (k, v) => { d[k] = v; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} },
  };
})();

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const COLORS = ['vermilion', 'mustard', 'teal', 'indigo', 'plum', 'moss'];
const colorOf = (id) => 'c-' + COLORS[CONTRACTS.findIndex((c) => c.id === id) % COLORS.length];

const TABS = [
  { id: 'judge', label: '判定', icon: '<path d="M12 3v18M5 7h14M7 7l-3 7a3.5 3.5 0 0 0 6 0L7 7zM17 7l-3 7a3.5 3.5 0 0 0 6 0l-3-7z"/>' },
  { id: 'drill', label: '演習', icon: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>' },
  { id: 'calc', label: '仕訳計算', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/>' },
  { id: 'prompt', label: 'プロンプト', icon: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>' },
  { id: 'notes', label: '基準メモ', icon: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>' },
];
const svg = (p, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.classList.add('out'), 1800);
  setTimeout(() => el.remove(), 2200);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('コピーしました'); } catch (e2) { toast('コピーできませんでした'); }
    ta.remove();
  }
}
const claudeUrl = (text) => 'https://claude.ai/new?q=' + encodeURIComponent(text);

// ── ルーティング ──
function go(tab) { location.hash = '#/' + tab; }
function route() {
  const tab = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'judge';
  const t = TABS.some((x) => x.id === tab) || tab === 'making' ? tab : 'judge';
  $('#tabbar').innerHTML = TABS.map((x) => `<a href="#/${x.id}" class="tab${x.id === t ? ' on' : ''}" ${x.id === t ? 'aria-current="page"' : ''}>${svg(x.icon)}<span>${x.label}</span></a>`).join('');
  ({ judge: renderJudge, drill: renderDrill, calc: renderCalc, prompt: renderPrompt, notes: renderNotes, making: renderMaking })[t]();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

const head = (kicker, title, lead) => `<header class="phead"><p class="kicker">${kicker}</p><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</header>`;

// ════════════════════════════════════════
// 判定ウィザード
// ════════════════════════════════════════
let wz = null; // { role, cur, path:[{node,label,ask,flag}], term, small, from }

function startWizard(roleId, from) {
  const role = ROLES.find((r) => r.id === roleId);
  wz = { role: roleId, cur: role.start, path: [], term: null, small: null, from: from || null };
  renderJudge();
}
function answer(label, next, extra = {}) {
  wz.path.push({ node: wz.cur, label, ...extra });
  wz.cur = typeof next === 'function' ? next(wz) : next;
  renderJudge();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function back() {
  const last = wz.path.pop();
  if (!last) { wz = null; } else { wz.cur = last.node; }
  renderJudge();
}

function renderJudge() {
  if (!wz) {
    app.innerHTML = head('新リース会計 ・ 企業会計基準第34号', '<span class="mk">リース判定</span>ナビ', '質問に答えていくと、リースの識別から会計処理の分類までを順にたどれます。迷う点は「不明・要確認」を選べば、確認事項として最後にまとめます。') + `
      <section class="block">
        <h2 class="h2">立場を選ぶ</h2>
        <div class="roles">${ROLES.map((r) => `<button class="role c-${r.color}" data-role="${r.id}"><span class="role-ic">${svg(r.icon, 24)}</span><span class="role-tx"><strong>${r.label}</strong><span>${r.sub}</span></span>${svg('<path d="M9 6l6 6-6 6"/>', 20)}</button>`).join('')}</div>
      </section>
      <section class="block">
        <h2 class="h2">演習の契約から始める</h2>
        <p class="muted">株式会社サンプル商事の6契約。条件を見ながら判定をたどれます。</p>
        <div class="chips">${CONTRACTS.map((c) => `<button class="chip ${colorOf(c.id)}" data-from="${c.id}"><b>${c.id}</b> ${esc(c.name)}</button>`).join('')}</div>
      </section>
      <a class="appx" href="#/making"><span class="appx-tag">付録</span><strong>このアプリは Claude への3つの指示で作りました</strong><span>実際の指示文と、その裏で Claude がしたこと</span>${svg('<path d="M9 6l6 6-6 6"/>', 20)}</a>`;
    app.querySelectorAll('[data-role]').forEach((b) => b.onclick = () => startWizard(b.dataset.role));
    app.querySelectorAll('[data-from]').forEach((b) => b.onclick = () => { const c = CONTRACTS.find((x) => x.id === b.dataset.from); startWizard(c.role, c.id); });
    return;
  }
  const role = ROLES.find((r) => r.id === wz.role);
  const from = wz.from && CONTRACTS.find((c) => c.id === wz.from);
  const top = `
    <div class="wz-top">
      <button class="ghost" id="wz-back">${svg('<path d="M15 6l-6 6 6 6"/>', 18)}戻る</button>
      <span class="pill">${esc(role.label)}</span>
      <button class="ghost" id="wz-reset">最初から</button>
    </div>
    <div class="prog" aria-hidden="true"><i style="width:${wz.cur.startsWith('R_') ? 100 : Math.min(92, 8 + wz.path.length * 11)}%"></i></div>
    ${from ? `<div class="ctx"><b>${from.id} ${esc(from.name)}</b><span>${esc(from.cond)}</span></div>` : ''}`;

  if (wz.cur.startsWith('R_')) return renderResult(top);

  const n = NODES[wz.cur];
  const step = wz.path.length + 1;
  let body = '';
  if (n.type === 'term') body = termForm();
  else if (n.type === 'small') body = smallForm();
  else if (n.type === 'fullpay') body = fullpayForm();
  else if (n.type === 'sublease') body = subleaseForm();
  else body = `<div class="opts">${n.options.map((o, i) => `<button class="opt${o.label.startsWith('不明') ? ' unk' : ''}" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`;

  app.innerHTML = top + `
    <section class="qcard">
      <p class="kicker">STEP ${step} ・ ${esc(n.section)}</p>
      <h2 class="q">${esc(n.q)}</h2>
      <p class="help">${esc(n.help)}</p>
      ${body}
    </section>
    ${trail()}`;
  $('#wz-back').onclick = back;
  $('#wz-reset').onclick = () => { wz = null; renderJudge(); };
  if (!n.type) {
    app.querySelectorAll('.opt').forEach((b) => b.onclick = () => {
      const o = n.options[+b.dataset.i];
      if (wz.cur === 'purchase') wz.purchase = o.value;
      answer(o.label, o.next, { ask: o.ask, flag: o.flag, why: o.why });
    });
  } else bindForm(n.type);
}

function trail() {
  if (!wz.path.length) return '';
  return `<section class="trail"><h3 class="h3">これまでの回答</h3><ol>${wz.path.map((p) => `<li><span>${esc(NODES[p.node].q)}</span><b>${esc(p.label)}</b></li>`).join('')}</ol></section>`;
}

// ── 数値入力つきの質問 ──
const field = (id, label, value, suffix, hint) => `<label class="field"><span>${label}</span><div class="inp"><input id="${id}" inputmode="decimal" value="${esc(value)}" autocomplete="off">${suffix ? `<em>${suffix}</em>` : ''}</div>${hint ? `<small>${hint}</small>` : ''}</label>`;
const select = (id, label, opts, val) => `<label class="field"><span>${label}</span><select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === val ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;

function preset() {
  const c = wz.from && CONTRACTS.find((x) => x.id === wz.from);
  return {
    L01: { non: 60, ext: 60, extC: 'unknown', pay: 2000000 },
    L03: { non: 10, ext: 0, extC: 'no', pay: 60000 * 8 },
    L02: { non: 120, ext: 0, extC: 'no', pay: 3500000 },
    L04: { non: 60, ext: 0, extC: 'no', pay: 45000 * 12, units: 12, newVal: 600000 },
  }[c ? c.id.replace('-', '') : ''] || {};
}

function termForm() {
  const p = preset();
  return `<div class="form">
    ${field('t-non', '解約不能期間', p.non ?? 60, 'か月')}
    <div class="row2">
      ${field('t-ext', '延長オプションの期間', p.ext ?? 0, 'か月')}
      ${select('t-extc', '延長の行使は', [['yes', '合理的に確実'], ['no', '合理的に確実でない'], ['unknown', '不明・要確認']], p.extC || 'no')}
    </div>
    <div class="row2">
      ${field('t-can', '解約オプションで短縮されうる期間', 0, 'か月', '解約不能期間の後、借手が解約できる期間')}
      ${select('t-canc', '解約しないことは', [['yes', '合理的に確実'], ['no', '合理的に確実でない'], ['unknown', '不明・要確認']], 'no')}
    </div>
    <div class="calcout" id="t-out"></div>
    <button class="primary" id="t-next">この期間で次へ</button>
  </div>`;
}
function smallForm() {
  const p = preset();
  const months = wz.term?.months || 12;
  return `<div class="form">
    <div class="row2">
      ${field('s-pay', '月額リース料（契約1件）', (p.pay ?? 50000).toLocaleString(), '円', `リース期間 ${months} か月で計算`)}
      ${field('s-units', '原資産の数量', p.units ?? 1, '台・件')}
    </div>
    <div class="row2">
      ${field('s-base', '減価償却資産の少額基準（社内方針）', '100,000', '円', '例：10万円・20万円・30万円')}
      ${field('s-new', '新品時の価値（1台あたり）', (p.newVal ?? 0).toLocaleString(), '円', '0 のままなら判定しない')}
    </div>
    ${field('s-fx', '5,000米ドルの換算レート', 150, '円／ドル')}
    <div id="s-out"></div>
  </div>`;
}
function fullpayForm() {
  return `<div class="form">
    ${field('f-pv', 'リース料総額の現在価値 ÷ 見積現金購入価額', 0, '%')}
    ${field('f-life', 'リース期間 ÷ 経済的耐用年数', 0, '%')}
    <div class="calcout" id="f-out"></div>
    <button class="primary" id="f-next">この数値で判定する</button>
  </div>`;
}
function subleaseForm() {
  const isL05 = wz.from === 'L-05';
  return `<div class="form">
    <div class="row2">
      ${field('u-sub', 'サブリース期間', isL05 ? 36 : 0, 'か月')}
      ${field('u-head', 'ヘッドリースの残りの期間', isL05 ? 120 : 0, 'か月')}
    </div>
    ${field('u-pv', 'サブリース料の現在価値 ÷ 使用権資産の帳簿価額（わかれば）', '', '%', '空欄なら期間の比だけで判定')}
    <div class="calcout" id="u-out"></div>
    <button class="primary" id="u-next">この数値で分類する</button>
  </div>`;
}

function bindForm(type) {
  const v = (id) => parseNum($('#' + id)?.value);
  const live = (ids, fn) => { ids.forEach((id) => $('#' + id).addEventListener('input', fn)); fn(); };

  if (type === 'term') {
    const calc = () => {
      const non = v('t-non'), ext = v('t-ext'), can = v('t-can');
      const extC = $('#t-extc').value, canC = $('#t-canc').value;
      const months = non + (extC === 'yes' ? ext : 0) + (canC === 'yes' ? can : 0);
      $('#t-out').innerHTML = `<span>リース期間</span><strong>${months} か月</strong><small>${(months / 12).toFixed(1).replace('.0', '')} 年 ・ ${non} ${extC === 'yes' && ext ? `＋ 延長 ${ext}` : ''}${canC === 'yes' && can ? ` ＋ 解約オプション ${can}` : ''}</small>`;
      return { months, non, ext, can, extC, canC };
    };
    live(['t-non', 't-ext', 't-can', 't-extc', 't-canc'], calc);
    $('#t-next').onclick = () => {
      const t = calc();
      wz.term = t;
      const asks = [];
      if (t.ext && t.extC === 'unknown') asks.push('延長オプションの行使見込み（過去の更新実績・移転コスト・事業計画）');
      if (t.can && t.canC === 'unknown') asks.push('解約オプションを行使しない見込み');
      answer(`${t.months} か月`, NODES.term.next, { ask: asks.join('／') || undefined, flag: t.extC === 'unknown' ? 'termUnknown' : undefined });
    };
  }

  if (type === 'small') {
    const calc = () => {
      const months = wz.term?.months || 12;
      const pay = v('s-pay'), units = Math.max(1, v('s-units')), base = v('s-base'), nv = v('s-new'), fx = v('s-fx') || 150;
      const total = pay * months, perUnit = total / units, usd = 5000 * fx;
      const checks = [
        { ok: base > 0 && perUnit <= base, label: '減価償却資産の少額基準以下', detail: `1台あたりリース料総額 ${yen(perUnit)} ／ 基準 ${yen(base)}`, note: '少額資産を購入時に費用処理している会社が対象' },
        { ok: total <= 3000000, label: '契約1件のリース料総額が300万円以下', detail: `リース料総額 ${yen(total)} ／ 基準 3,000,000`, note: '事業内容に照らして重要性が乏しいリースが対象' },
        { ok: nv > 0 && nv <= usd, na: !nv, label: '新品時の価値が5,000米ドル程度以下', detail: nv ? `1台 ${yen(nv)} ／ 目安 ${yen(usd)}` : '新品時の価値が未入力', note: 'IFRS 16 と同じ考え方' },
      ];
      const any = checks.some((c) => c.ok);
      $('#s-out').innerHTML = `<ul class="checks">${checks.map((c) => `<li class="${c.ok ? 'ok' : c.na ? 'na' : 'ng'}"><i>${c.ok ? '✓' : c.na ? '–' : '✕'}</i><div><b>${c.label}</b><span>${c.detail}</span><small>${c.note}</small></div></li>`).join('')}</ul>
        ${any ? `<p class="verdict ok">少額リースの簡便処理を選べる可能性があります</p>
          <div class="btns"><button class="primary" id="s-simple">簡便処理を選ぶ</button><button class="secondary" id="s-on">オンバランスで処理する</button></div>`
        : `<p class="verdict">少額リースには当たりません</p><button class="primary" id="s-on">次へ（オンバランス）</button>`}`;
      $('#s-simple') && ($('#s-simple').onclick = () => { wz.small = { total, pay }; answer('少額リースの簡便処理を選ぶ', 'R_small', { ask: '少額リースの判定基準と判定単位の社内方針' }); });
      $('#s-on').onclick = () => { wz.small = { total, pay }; answer(any ? '簡便処理を選ばない' : '少額に当たらない', 'R_onBS'); };
    };
    live(['s-pay', 's-units', 's-base', 's-new', 's-fx'], calc);
  }

  if (type === 'fullpay') {
    const calc = () => {
      const pv = v('f-pv'), life = v('f-life');
      const fl = pv >= 90 || life >= 75;
      $('#f-out').innerHTML = `<span>判定</span><strong>${fl ? 'ファイナンス・リース' : 'オペレーティング・リース'}</strong><small>現在価値 ${pv}%（基準 90%）・耐用年数 ${life}%（基準 75%）</small>`;
      return fl;
    };
    live(['f-pv', 'f-life'], calc);
    $('#f-next').onclick = () => { const fl = calc(); answer(`現在価値 ${v('f-pv')}%・耐用年数 ${v('f-life')}%`, fl ? 'R_FLnt' : 'R_OL'); };
  }

  if (type === 'sublease') {
    const calc = () => {
      const sub = v('u-sub'), headM = v('u-head'), pvRaw = $('#u-pv').value.trim(), pv = parseNum(pvRaw);
      const ratio = headM ? Math.round((sub / headM) * 100) : 0;
      const fl = ratio >= 75 || (pvRaw !== '' && pv >= 90);
      $('#u-out').innerHTML = `<span>分類</span><strong>${fl ? 'ファイナンス・リース' : 'オペレーティング・リース'}</strong><small>期間の比 ${ratio}%（目安 75%）${pvRaw !== '' ? `・現在価値 ${pv}%（目安 90%）` : ''}</small>`;
      return { fl, ratio };
    };
    live(['u-sub', 'u-head', 'u-pv'], calc);
    $('#u-next').onclick = () => { const r = calc(); answer(`期間の比 ${r.ratio}%`, r.fl ? 'R_subFL' : 'R_subOL', { ask: 'ヘッドリースの使用権資産の帳簿価額とサブリース料の現在価値' }); };
  }
}

function renderResult(top) {
  const r = RESULTS[wz.cur];
  const asks = wz.path.filter((p) => p.ask).flatMap((p) => p.ask.split('／'));
  const from = wz.from && CONTRACTS.find((c) => c.id === wz.from);
  if (from?.ask) asks.push(...from.ask.split('、').map((s) => s.trim()));
  const uniq = [...new Set(asks)];
  const whyNode = [...wz.path].reverse().find((p) => p.why);
  if (from) {
    const done = store.get('judged', {});
    done[from.id] = r.badge;
    store.set('judged', done);
  }
  app.innerHTML = top + `
    <section class="result tone-${r.tone}">
      <span class="badge">${esc(r.badge)}</span>
      <h2>${esc(r.title)}</h2>
      ${whyNode ? `<p class="why">理由：${esc(whyNode.why)}</p>` : ''}
      <p>${esc(r.summary)}</p>
      ${wz.term ? `<p class="meta">リース期間 <b>${wz.term.months} か月</b>${wz.purchase === 'yes' ? '・購入オプションあり' : ''}</p>` : ''}
    </section>
    <section class="block">
      <h3 class="h3">留意点</h3>
      <ul class="dots">${r.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    </section>
    ${uniq.length ? `<section class="block ask"><h3 class="h3">確認事項（${uniq.length}件）</h3><ul class="dots">${uniq.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></section>` : ''}
    ${from ? `<section class="block"><h3 class="h3">研修資料の解説と比べる</h3><dl class="kv"><dt>判定・処理</dt><dd>${esc(from.judge)}</dd><dt>潜在リスク</dt><dd>${esc(from.risk)}</dd></dl></section>` : ''}
    <div class="btns stack">
      ${r.calc ? '<button class="primary" id="r-calc">仕訳と償却表を計算する</button>' : ''}
      <button class="${r.calc ? 'secondary' : 'primary'}" id="r-prompt">この判定を Claude に検証させる</button>
      <button class="secondary" id="r-again">別の契約を判定する</button>
    </div>
    ${trail()}
    <p class="fine">研修用の簡易ナビです。判定の根拠は基準・適用指針の原文で、金額は Excel で、事実は契約書で確かめてください。</p>`;
  $('#wz-back').onclick = back;
  $('#wz-reset').onclick = () => { wz = null; renderJudge(); };
  $('#r-again').onclick = () => { wz = null; renderJudge(); };
  $('#r-calc') && ($('#r-calc').onclick = () => {
    const c = from?.calc || {};
    store.set('calc', { ...store.get('calc', {}), pay: wz.small?.pay || c.pay || store.get('calc', {}).pay || 100000, months: wz.term?.months || c.months || 60, rate: c.rate || store.get('calc', {}).rate || 2 });
    go('calc');
  });
  $('#r-prompt').onclick = () => {
    const lines = wz.path.map((p) => `・${NODES[p.node].q} → ${p.label}`).join('\n');
    const head = from ? `${from.id} ${from.name}：${from.cond}` : `（契約の要点を匿名化して記入）`;
    store.set('promptContracts', `${head}\n\nアプリでの判定経過：\n${lines}\n判定結果：${r.badge}（${r.title}）${uniq.length ? `\n確認事項：${uniq.join('／')}` : ''}`);
    store.set('promptRole', wz.role === 'lessor' ? '貸手' : '借手');
    go('prompt');
  };
}

// ════════════════════════════════════════
// 演習（6契約のクイズ）
// ════════════════════════════════════════
let drillOpen = null;
function renderDrill() {
  const scores = store.get('quiz', {});
  const n = Object.keys(scores).length, ok = Object.values(scores).filter((x) => x).length;
  if (!drillOpen) {
    app.innerHTML = head('演習 ・ 株式会社サンプル商事', '<span class="mk">6契約</span>を判定する', '実務で判断が分かれやすい論点を1件ずつ仕込んだ演習データです。1問答えると、研修資料の解説と辞書への質問が開きます。') + `
      <div class="score"><div><strong>${ok}</strong><span>/ ${CONTRACTS.length} 正解</span></div><div class="bar"><i style="width:${(n / CONTRACTS.length) * 100}%"></i></div>${n ? '<button class="ghost" id="q-reset">リセット</button>' : ''}</div>
      <div class="cards">${CONTRACTS.map((c) => {
        const s = scores[c.id];
        return `<button class="ccard ${colorOf(c.id)}" data-id="${c.id}">
          <div class="ctop"><b>${c.id}</b>${s === undefined ? '<span class="st">未回答</span>' : s ? '<span class="st ok">正解</span>' : '<span class="st ng">要復習</span>'}</div>
          <h3>${esc(c.name)}</h3><p>${esc(c.cond)}</p><small>論点：${esc(c.issue)}</small></button>`;
      }).join('')}</div>`;
    app.querySelectorAll('.ccard').forEach((b) => b.onclick = () => { drillOpen = { id: b.dataset.id, picked: null }; renderDrill(); window.scrollTo(0, 0); });
    $('#q-reset') && ($('#q-reset').onclick = () => { store.set('quiz', {}); renderDrill(); });
    return;
  }
  const i = CONTRACTS.findIndex((x) => x.id === drillOpen.id);
  const c = CONTRACTS[i];
  const picked = drillOpen.picked;
  const next = CONTRACTS[i + 1];
  app.innerHTML = `
    <div class="wz-top"><button class="ghost" id="d-back">${svg('<path d="M15 6l-6 6 6 6"/>', 18)}一覧</button><span class="pill">${i + 1} / ${CONTRACTS.length}</span><span></span></div>
    <section class="qcard">
      <p class="kicker">${c.id} ・ ${esc(c.name)}</p>
      <p class="cond">${esc(c.cond)}</p>
      <h2 class="q">${esc(c.quiz.q)}</h2>
      <div class="opts">${c.quiz.options.map((o, k) => {
        let cls = 'opt';
        if (picked !== null) cls += k === c.quiz.answer ? ' right' : k === picked ? ' wrong' : ' dim';
        return `<button class="${cls}" data-k="${k}" ${picked !== null ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('')}</div>
    </section>
    ${picked === null ? `<p class="muted center">答えを選ぶと解説が開きます</p><div class="btns stack"><button class="secondary" id="d-wz">判定ナビでたどってみる</button></div>` : `
    <section class="result tone-${picked === c.quiz.answer ? 'ok' : 'ng'}">
      <span class="badge">${picked === c.quiz.answer ? '正解！' : 'おしい！'}</span>
      <h2>${esc(c.judge)}</h2>
      <p class="why">論点：${esc(c.issue)}</p>
    </section>
    <section class="block"><dl class="kv"><dt>潜在リスク</dt><dd>${esc(c.risk)}</dd><dt>確認事項</dt><dd>${esc(c.ask)}</dd><dt>根拠</dt><dd>基準第34号・適用指針第33号 第__項 <span class="tag">辞書で原文確認</span></dd></dl></section>
    <section class="block">
      <h3 class="h3">辞書 Project への質問（そのまま入力）</h3>
      <div class="quote">${esc(c.dict)}</div>
      <div class="btns"><button class="secondary" id="d-copy">コピー</button><a class="secondary" href="${claudeUrl(c.dict)}" target="_blank" rel="noopener">Claude で開く</a></div>
    </section>
    <div class="btns stack">
      ${next ? `<button class="primary" id="d-next">次の契約へ（${next.id}）</button>` : '<button class="primary" id="d-list">結果を見る</button>'}
      <button class="secondary" id="d-wz">判定ナビでたどってみる</button>
    </div>`}`;
  $('#d-back').onclick = () => { drillOpen = null; renderDrill(); };
  app.querySelectorAll('.opt').forEach((b) => b.onclick = () => {
    const k = +b.dataset.k;
    drillOpen.picked = k;
    const sc = store.get('quiz', {}); sc[c.id] = k === c.quiz.answer; store.set('quiz', sc);
    renderDrill();
  });
  $('#d-copy') && ($('#d-copy').onclick = () => copy(c.dict));
  $('#d-next') && ($('#d-next').onclick = () => { drillOpen = { id: next.id, picked: null }; renderDrill(); window.scrollTo(0, 0); });
  $('#d-list') && ($('#d-list').onclick = () => { drillOpen = null; renderDrill(); });
  $('#d-wz') && ($('#d-wz').onclick = () => { startWizard(c.role, c.id); go('judge'); });
}

// ════════════════════════════════════════
// 仕訳計算（リース負債・使用権資産・償却表）
// ════════════════════════════════════════
function renderCalc() {
  const s = { pay: 2000000, months: 60, rate: 2, timing: 'arrears', idc: 0, ...store.get('calc', {}) };
  app.innerHTML = head('借手 ・ 使用権資産とリース負債', '<span class="mk">仕訳</span>と償却表', '月額リース料・リース期間・割引率から、期首の計上額と毎月の仕訳、年ごとの償却表をつくります。CSV を Excel に取り込んで検算できます。') + `
    <section class="block form">
      <div class="presets">${CONTRACTS.filter((c) => c.calc).map((c) => `<button class="chip ${colorOf(c.id)}" data-p="${c.id}"><b>${c.id}</b> ${esc(c.name)}</button>`).join('')}</div>
      <div class="row2">
        ${field('c-pay', '月額リース料', s.pay.toLocaleString(), '円')}
        ${field('c-months', 'リース期間', s.months, 'か月')}
      </div>
      <div class="row2">
        ${field('c-rate', '割引率（年）', s.rate, '%', '貸手の計算利子率、不明なら追加借入利子率')}
        ${select('c-timing', '支払時期', [['arrears', '毎月末払い（後払い）'], ['advance', '毎月初払い（前払い）']], s.timing)}
      </div>
      ${field('c-idc', '初期直接費用（使用権資産に加算）', (s.idc || 0).toLocaleString(), '円')}
    </section>
    <div id="c-out"></div>`;
  const read = () => ({ pay: parseNum($('#c-pay').value), months: Math.round(parseNum($('#c-months').value)), rate: parseNum($('#c-rate').value), timing: $('#c-timing').value, idc: parseNum($('#c-idc').value) });
  const draw = () => {
    const p = read();
    store.set('calc', p);
    if (!(p.pay > 0 && p.months > 0 && p.months <= 600)) { $('#c-out').innerHTML = '<p class="muted center">月額とリース期間（600か月以内）を入力してください</p>'; return; }
    const r = schedule(p);
    const m1 = r.rows[0];
    const fy1 = r.years[0];
    const current = p.pay * Math.min(12, p.months);
    $('#c-out').innerHTML = `
      <section class="kpis">
        <div><span>リース負債（当初）</span><strong>${yen(r.liability)}</strong></div>
        <div><span>使用権資産（当初）</span><strong>${yen(r.rou)}</strong></div>
        <div><span>月次の減価償却費</span><strong>${yen(m1.dep)}</strong></div>
        <div><span>初月の支払利息</span><strong>${yen(m1.interest)}</strong></div>
      </section>
      <section class="block">
        <h3 class="h3">仕訳 — 現行と新基準を並べる</h3>
        <div class="je-grid">
          <div class="je old"><p class="je-h">現行 ・ 賃借料処理（毎月）</p>${je([['支払家賃', p.pay, '現金預金', p.pay]])}</div>
          <div class="je new"><p class="je-h">新基準 ・ リース開始日</p>${je([['使用権資産', r.rou, 'リース負債', r.liability], ...(p.idc ? [['', 0, '現金預金', p.idc]] : [])])}
            <p class="je-h">新基準 ・ 1か月目</p>${je([
              ['減価償却費', m1.dep, '使用権資産', m1.dep],
              ...(m1.interest ? [['支払利息', m1.interest, 'リース負債', m1.interest]] : []),
              ['リース負債', p.pay, '現金預金', p.pay],
            ])}</div>
        </div>
        <p class="fine">使用権資産はリース期間で定額償却しています。所有権移転の場合は経済的耐用年数で償却します。利息はリース負債に計上し、支払時にまとめて取り崩す表示にしています。</p>
      </section>
      <section class="block">
        <h3 class="h3">初年度の P/L への影響</h3>
        <div class="compare">
          <div><span>現行（賃借料）</span><strong>${yen(current)}</strong></div>
          <div><span>新基準（減価償却費＋支払利息）</span><strong>${yen(fy1.dep + fy1.interest)}</strong><small>減価償却 ${yen(fy1.dep)} ／ 利息 ${yen(fy1.interest)}</small></div>
        </div>
        <ul class="dots"><li>営業費用は賃借料から減価償却費に置き換わり、初年度の営業利益は ${yen(current - fy1.dep)} 変わります。EBITDA は賃借料の全額 ${yen(current)} だけ増えます。</li><li>B/S に使用権資産とリース負債が両建てで載り、自己資本比率・有利子負債の指標が動きます。財務制限条項への影響を確認します。</li><li>費用は前半に重く後半に軽くなります（利息が逓減するため）。</li></ul>
      </section>
      <section class="block">
        <div class="h3row"><h3 class="h3">年ごとの償却表</h3><button class="secondary sm" id="c-csv">CSV（月次）</button></div>
        <div class="tbl"><table><thead><tr><th>年</th><th>支払リース料</th><th>支払利息</th><th>元本返済</th><th>期末リース負債</th><th>減価償却費</th><th>期末使用権資産</th></tr></thead>
        <tbody>${r.years.map((y) => `<tr><td>${y.year}年目</td><td>${yen(y.pay)}</td><td>${yen(y.interest)}</td><td>${yen(y.principal)}</td><td>${yen(y.liab)}</td><td>${yen(y.dep)}</td><td>${yen(y.rou)}</td></tr>`).join('')}
        <tr class="sum"><td>合計</td><td>${yen(r.totals.pay)}</td><td>${yen(r.totals.interest)}</td><td>${yen(r.totals.principal)}</td><td></td><td>${yen(r.totals.dep)}</td><td></td></tr></tbody></table></div>
        <details class="monthly"><summary>月次の明細を表示（${r.rows.length} か月）</summary><div class="tbl"><table><thead><tr><th>月</th><th>期首負債</th><th>支払</th><th>利息</th><th>元本</th><th>期末負債</th><th>償却</th><th>期末使用権資産</th></tr></thead><tbody>${r.rows.map((m) => `<tr><td>${m.n}</td><td>${yen(m.open)}</td><td>${yen(m.pay)}</td><td>${yen(m.interest)}</td><td>${yen(m.principal)}</td><td>${yen(m.close)}</td><td>${yen(m.dep)}</td><td>${yen(m.rou)}</td></tr>`).join('')}</tbody></table></div></details>
      </section>
      <p class="fine">円未満は月ごとに四捨五入し、最終月で端数を調整しています。AI や本アプリの数字は、必ず Excel で検算してください（研修資料 裏取り2）。</p>`;
    $('#c-csv').onclick = () => {
      const lines = [['月', '期首リース負債', '支払リース料', '支払利息', '元本返済', '期末リース負債', '減価償却費', '期末使用権資産'], ...r.rows.map((m) => [m.n, m.open, m.pay, m.interest, m.principal, m.close, m.dep, m.rou])];
      const blob = new Blob(['﻿' + lines.map((l) => l.join(',')).join('\r\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lease_schedule_${p.months}m_${p.rate}pct.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  };
  app.querySelectorAll('.form input, .form select').forEach((el) => el.addEventListener('input', draw));
  app.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
    const c = CONTRACTS.find((x) => x.id === b.dataset.p).calc;
    $('#c-pay').value = c.pay.toLocaleString(); $('#c-months').value = c.months; $('#c-rate').value = c.rate;
    draw();
  });
  draw();
}
function je(rows) {
  return `<table class="jet"><tbody>${rows.map(([dr, da, cr, ca]) => `<tr><td>${dr ? `（借）${esc(dr)}` : ''}</td><td class="n">${dr ? yen(da) : ''}</td><td>（貸）${esc(cr)}</td><td class="n">${yen(ca)}</td></tr>`).join('')}</tbody></table>`;
}

// ════════════════════════════════════════
// プロンプト生成（判定プロンプト v2・辞書の指示文）
// ════════════════════════════════════════
const DEFAULT_CONTRACTS = CONTRACTS.map((c) => `${c.id} ${c.name}：${c.cond}`).join('\n');
function buildPrompt(o) {
  const persp = PERSPECTIVES.filter((p) => o.persp.includes(p.id)).map((p) => `・${p.text}`).join('\n');
  return `# 目的
${o.company}（${o.role}・${o.fy}決算）が新リース会計基準（企業会計基準第34号）を適用するにあたり、契約ごとの会計処理を決めるための判定の下書きを作ります。読み手は会計アドバイザリーの担当者です。

# 前提
以下に契約の要点を貼ります（社名・物件名は匿名化済み）。現在は全件を賃借料として費用処理しています。

${o.contracts}

# 出力の形
契約ごとに1行の表。列は、判定（リースに該当するか）・リース期間の見積り・適用する処理（通常／短期／少額）・根拠（基準・適用指針の項番号）・仕訳案（現行の賃借料処理と新基準の処理を並べる）・潜在リスク・確認事項。表の後に、全体の留意点を3点以内で。

# 判断の基準
企業会計基準第34号と適用指針第33号に従います。契約書の条項・取引の実態・仕訳への反映の3層で見ます。情報が不足する点は断定せず「確認事項」に書きます。項番号に自信がない場合は「要原文確認」と付けます。
${persp}`;
}
function renderPrompt() {
  const st = {
    company: '株式会社サンプル商事', role: store.get('promptRole', '借手'), fy: '3月',
    contracts: store.get('promptContracts', DEFAULT_CONTRACTS),
    persp: store.get('promptPersp', PERSPECTIVES.map((p) => p.id)),
  };
  app.innerHTML = head('第2部・第3部 ・ そのまま入力', '<span class="mk">プロンプト</span>をつくる', '研修の4要素（目的・前提・出力の形・判断の基準）で判定プロンプト v2 を組み立てます。お客様の機密情報は入れず、契約の要点を匿名化して貼ってください。') + `
    <section class="block form">
      <div class="row3">
        ${field('p-company', '会社名（架空・匿名）', st.company, '')}
        ${select('p-role', '立場', [['借手', '借手'], ['貸手', '貸手']], st.role)}
        ${field('p-fy', '決算月', st.fy, '')}
      </div>
      <label class="field"><span>契約の要点（1行1契約）</span><textarea id="p-contracts" rows="7">${esc(st.contracts)}</textarea></label>
      <div class="btns"><button class="ghost sm" id="p-demo">演習の6契約に戻す</button></div>
      <fieldset class="persp"><legend>判断の基準に足す観点（v1 のずれを直す追記）</legend>
        ${PERSPECTIVES.map((p) => `<label class="check"><input type="checkbox" value="${p.id}" ${st.persp.includes(p.id) ? 'checked' : ''}><span>${p.label}</span></label>`).join('')}
      </fieldset>
    </section>
    <section class="block">
      <div class="h3row"><h3 class="h3">判定プロンプト v2</h3><span class="muted" id="p-len"></span></div>
      <pre class="prompt" id="p-out"></pre>
      <div class="btns"><button class="primary" id="p-copy">コピー</button><a class="secondary" id="p-open" target="_blank" rel="noopener">Claude で開く</a></div>
    </section>
    <section class="block">
      <h3 class="h3">改善版を Claude に書かせる（STEP 03）</h3>
      <div class="quote" id="p-improve">あなたはリース会計に詳しい会計士です。次のプロンプトを読み、リース判定で抜けている観点と、出力が曖昧になりそうな箇所を指摘してください。そのうえで、4要素（目的・前提・出力の形・判断の基準）の構成を保った改善版を書いてください。</div>
      <div class="btns"><button class="secondary" id="p-copy2">プロンプトごとコピー</button></div>
    </section>
    <section class="block">
      <h3 class="h3">電子辞書 Project の指示文</h3>
      <p class="muted">Project のナレッジに基準第34号・適用指針第33号・設例の PDF を登録し、指示文に貼ります。</p>
      <div class="quote">${esc(DICT_PROMPT)}</div>
      <div class="btns"><button class="secondary" id="p-copy3">コピー</button></div>
    </section>`;
  const read = () => ({
    company: $('#p-company').value.trim() || '株式会社サンプル商事', role: $('#p-role').value, fy: $('#p-fy').value.trim() || '3月',
    contracts: $('#p-contracts').value.trim(), persp: [...app.querySelectorAll('.persp input:checked')].map((x) => x.value),
  });
  let text = '';
  const draw = () => {
    const o = read();
    store.set('promptContracts', o.contracts); store.set('promptRole', o.role); store.set('promptPersp', o.persp);
    text = buildPrompt(o);
    $('#p-out').textContent = text;
    $('#p-len').textContent = `${text.length.toLocaleString()} 文字`;
    $('#p-open').href = claudeUrl(text);
  };
  app.querySelectorAll('.form input, .form select, .form textarea').forEach((el) => el.addEventListener('input', draw));
  $('#p-demo').onclick = () => { $('#p-contracts').value = DEFAULT_CONTRACTS; draw(); };
  $('#p-copy').onclick = () => copy(text);
  $('#p-copy2').onclick = () => copy($('#p-improve').textContent + '\n\n---\n\n' + text);
  $('#p-copy3').onclick = () => copy(DICT_PROMPT);
  draw();
}

// ════════════════════════════════════════
// 基準メモ
// ════════════════════════════════════════
function renderNotes() {
  app.innerHTML = head('IFRS × AI 勉強会', '<span class="mk">基準メモ</span>', '判定の骨格と、IFRS 16 との違いを1枚にまとめました。項番号はあえて載せていません。辞書 Project で原文を引いて確かめてください。') + `
    <section class="block">
      <h2 class="h2">判定の骨格 — 借手</h2>
      <ol class="flow">
        <li><b>リースを含むか</b><span>特定された資産がある／供給者の入替権が実質的でない／経済的利益のほとんどすべてを享受する／使用を指図する</span></li>
        <li><b>構成部分を分ける</b><span>保守・サービスなど非リース構成部分は分離が原則。分離しない簡便法はクラスごとに選択</span></li>
        <li><b>リース期間を決める</b><span>解約不能期間＋行使が合理的に確実な延長＋行使しないことが合理的に確実な解約</span></li>
        <li><b>簡便処理を選ぶか</b><span>短期（12か月以内・購入オプションなし）／少額</span></li>
        <li><b>計上する</b><span>リース負債＝リース料の現在価値。使用権資産＝リース負債＋前払リース料＋初期直接費用 など</span></li>
      </ol>
    </section>
    <section class="block">
      <h2 class="h2">日本基準と IFRS 16 の主な違い</h2>
      <div class="diff">${IFRS_DIFF.map((d) => `<article><h3>${esc(d.topic)}${d.confirm ? '<span class="tag">要原文確認</span>' : ''}</h3><dl><dt>日本基準</dt><dd>${esc(d.jp)}</dd><dt>IFRS 16</dt><dd>${esc(d.ifrs)}</dd></dl></article>`).join('')}</div>
    </section>
    <section class="block">
      <h2 class="h2">AI の出力を裏取りする3つの習慣</h2>
      <div class="three">
        <div><b>根拠は原文で開く</b><span>項番号を必ず出させ、原文をその番号で開いて要旨が一致するか確かめる</span></div>
        <div><b>金額は Excel で検算</b><span>現在価値・使用権資産・利息と減価償却の配分を再計算する</span></div>
        <div><b>事実は契約書と現場で</b><span>更新オプションの行使見込みや資産の特定は、原本と担当者で確かめる</span></div>
      </div>
    </section>
    <section class="block">
      <h2 class="h2">入力してよい情報</h2>
      <ul class="lvl"><li class="ok"><b>入力可</b>基準・適用指針・IFRS 16、有価証券報告書の開示例などの公開情報</li><li class="ok"><b>入力可</b>社名・物件名を伏せた契約条件、架空の演習データ</li><li class="ng"><b>入力不可</b>契約書の原本 PDF、取引先名入りのリース一覧、お客様との会議記録</li></ul>
    </section>
    <a class="appx" href="#/making"><span class="appx-tag">付録</span><strong>このアプリは Claude への3つの指示で作りました</strong><span>実際の指示文と、その裏で Claude がしたこと</span>${svg('<path d="M9 6l6 6-6 6"/>', 20)}</a>
    <p class="fine">本アプリは研修用の学習ツールで、会計処理の最終判断を代替するものではありません。内容は企業会計基準第34号「リースに関する会計基準」・企業会計基準適用指針第33号（2024年9月公表）を前提に作成しています。<br>はてなベース株式会社</p>`;
}

// ════════════════════════════════════════
// 付録：このアプリの作り方（Claude への指示）
// ════════════════════════════════════════
const MAKING_ASKS = [
  {
    n: '指示 1', title: 'つくって公開する',
    text: '以前作ってくれた英単語アプリみたいな感じで明日のIFRS×AI勉強会に必要な新リース会計のリース判定アプリをつくって私のgithubで公開してみてよ。（研修資料の Claude Design の URL）',
    did: ['研修資料（25枚）を読み、演習の6契約・解説・辞書への質問・仕訳の出力例を抜き出す', '以前の英単語アプリの構成（ビルド不要の Web アプリ・GitHub Pages）を読んで、同じ作りにする', '画面を5つに分けて設計し、判定フロー・計算・プロンプト生成を実装する', 'iPhone の表示で一通り操作して確かめ、GitHub に公開する'],
  },
  {
    n: '指示 2', title: '見た目を変える',
    text: '以前作った英単語アプリみたいに、もうちょっとポップで見やすく可愛くして？',
    did: ['英単語アプリのデザイン（色・線・影・書体）を読み取って、同じ文法で描き直す', '契約や立場ごとに色を分け、正解スタンプや進捗バーを足す', 'スクリーンショットで崩れがないか見てから公開する'],
  },
  {
    n: '指示 3', title: '作り方を残す',
    text: 'アプリの中に、付録としてこのアプリをどのようにclaudeに命令して作ったかを書いてあげて',
    did: ['これまでの指示とやったことを振り返り、このページを書く'],
  },
];
const MAKING_TEMPLATE = `# 目的
明日の研修で受講者が使う、新リース会計のリース判定を学べる Web アプリを作ってください。受講者はスマホで開きます。

# 前提
・研修資料はこれです：（資料の URL やファイル）。演習データ（契約6件）と解説はここから取ってください
・以前作ったこのアプリと同じ作り・見た目にしてください：（参考アプリの場所）
・私の GitHub で公開します

# 出力の形
・画面は「判定フロー」「演習クイズ」「仕訳計算」「プロンプト生成」「基準メモ」の5つ
・公開 URL と、確かめた内容を最後に報告してください

# 判断の基準
・企業会計基準第34号に沿うこと。自信のない記載には「要原文確認」を付ける
・項番号は載せない（受講者が原文で引く練習をするため）
・お客様の情報は入れない。演習データは架空の会社のものだけ使う`;

function renderMaking() {
  app.innerHTML = head('付録 ・ Claude Code で作りました', 'このアプリの<span class="mk">作り方</span>', '研修の第1部と同じ考え方で作っています。送った指示はたった3つ。短い指示でも形になったのは、「前提」を参考物で渡したからです。') + `
    <section class="block">
      <h2 class="h2">実際に送った指示</h2>
      <ol class="asks">${MAKING_ASKS.map((a, i) => `
        <li class="c-${['vermilion', 'teal', 'plum'][i]}">
          <div class="ask-h"><b>${a.n}</b><span>${a.title}</span></div>
          <div class="bubble">${esc(a.text)}</div>
          <p class="did-h">Claude がしたこと</p>
          <ul class="dots">${a.did.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
        </li>`).join('')}</ol>
      <p class="fine">途中で作業が止まったときに「つづけて」と送ったほかは、指示はこの3つだけです。</p>
    </section>
    <section class="block">
      <h2 class="h2">短い指示で済んだ理由 — 4要素で読む</h2>
      <div class="four">
        <div><b>目的</b><span>「明日の勉強会に必要な」「リース判定アプリ」。誰が何に使うかは一文で伝わる</span></div>
        <div><b>前提</b><span>研修資料の URL を渡したので、演習データ・解説・用語をすべて資料から取れた</span></div>
        <div><b>出力の形</b><span>「英単語アプリみたいに」の一言で、作り・見た目・公開方法まで決まった</span></div>
        <div><b>判断の基準</b><span>ここは指示していない。Claude が研修資料の方針（原文で裏取り・機密は入れない）から補った</span></div>
      </div>
      <div class="lesson"><b>ポイント</b><span>長い説明を書くより、参考になる実物（資料・過去の成果物）を渡すほうが早く、ぶれない。</span></div>
    </section>
    <section class="block">
      <h2 class="h2">作ったあとに確かめたこと</h2>
      <ul class="dots">
        <li>計算：月額 2,000,000・60か月・年2% でリース負債 114,104,711、最終月に残高 0 になることを確認</li>
        <li>画面：iPhone の表示で判定・演習・計算・プロンプトを通しで操作し、エラーがないことを確認</li>
        <li>Claude の誤り：P/L への影響の説明文に誤りがあった。Claude が自分でスクリーンショットを見直して気づき、直した。作らせたアプリでも、中身の裏取りは要る</li>
        <li>資料の不整合：アプリで計算したことで、研修資料の仕訳例の数字の前提が揃っていないことが見つかった</li>
      </ul>
    </section>
    <section class="block">
      <h2 class="h2">自分で作るなら — 4要素の指示文</h2>
      <p class="muted">最初から4要素で書くと、やり直しがさらに減ります。（ ）の中を自分のものに差し替えてください。</p>
      <pre class="prompt">${esc(MAKING_TEMPLATE)}</pre>
      <div class="btns"><button class="primary" id="m-copy">コピー</button></div>
    </section>
    <p class="fine">使ったもの：Claude Code（Claude Opus 5.5）、Claude Design の研修資料、GitHub Pages。</p>`;
  $('#m-copy').onclick = () => copy(MAKING_TEMPLATE);
}

route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
