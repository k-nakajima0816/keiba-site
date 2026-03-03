/* ===================================================
   FRONT RUNNER — app.js
   メインロジック（ナビ描画、認証、データ取得、描画）
   =================================================== */

// ─── 定数 ───
const MARKS = ['◎', '○', '▲', '△'];
const MARK_CLASSES = { '◎': 'mark-honmei', '○': 'mark-taikou', '▲': 'mark-tanana', '△': 'mark-renka' };

// JRA標準枠色（1〜8枠）
const WAKU_COLORS = [
  { bg: '#ffffff', text: '#333', border: '#ccc' },     // 1枠 白
  { bg: '#333333', text: '#fff', border: '#333' },     // 2枠 黒
  { bg: '#e4002b', text: '#fff', border: '#e4002b' },  // 3枠 赤
  { bg: '#0068b7', text: '#fff', border: '#0068b7' },  // 4枠 青
  { bg: '#f4d500', text: '#333', border: '#c8ab00' },  // 5枠 黄
  { bg: '#00a73c', text: '#fff', border: '#00a73c' },  // 6枠 緑
  { bg: '#f39800', text: '#fff', border: '#f39800' },  // 7枠 橙
  { bg: '#e85298', text: '#fff', border: '#e85298' },  // 8枠 桃
];

// ─── ユーティリティ ───
function getBasePath() {
  const path = window.location.pathname;
  const lastSlash = path.lastIndexOf('/');
  return path.substring(0, lastSlash + 1);
}

async function fetchJSON(path) {
  try {
    const base = getBasePath();
    const res = await fetch(base + path);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function qs(sel, parent) { return (parent || document).querySelector(sel); }
function qsa(sel, parent) { return (parent || document).querySelectorAll(sel); }

function getParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

// ─── 的中速報ティッカー共通ヘルパー ───
function buildHitsTickerHTML(hitsData, predictors, options = {}) {
  const { linkHref = 'hits.html', showFallback = true } = options;
  if (!hitsData || !hitsData.hits || hitsData.hits.length === 0) {
    return showFallback ? `<a href="${linkHref}" class="hits-banner-link">🎯 的中速報を見る</a>` : '';
  }
  const predictorMap = {};
  if (predictors) predictors.forEach(p => predictorMap[p.id] = p);
  let items = '';
  for (const hit of hitsData.hits) {
    const p = predictorMap[hit.predictorId];
    const name = p ? p.name : hit.predictorId;
    const color = p ? p.color : '#999';
    const initial = name ? name[0] : '?';
    items += `<span class="hits-ticker-item">
      <span class="hits-ticker-avatar" style="background:${color}">${initial}</span>
      <span>${name}</span>
      <span class="hits-ticker-badge">${hit.hitLabel}</span>
      <span class="hits-ticker-payout">¥${hit.payoutAmount.toLocaleString()}</span>
    </span>`;
  }
  return `<div class="hits-ticker-wrapper">
    <a href="${linkHref}" class="hits-ticker-label">🎯 的中速報</a>
    <div class="hits-ticker-track">
      <div class="hits-ticker-scroll">${items}${items}</div>
    </div>
  </div>`;
}

/**
 * JRA標準枠番計算
 * totalHorses <= 8: 馬番 = 枠番
 * totalHorses > 8:  余り分を後ろの枠から2頭ずつ割り当て
 */
function getWakuNumber(horseNumber, totalHorses) {
  if (totalHorses <= 8) return horseNumber;
  const extra = totalHorses - 8;
  const doubleStart = 8 - extra; // この枠番以降が2頭
  let count = 0;
  for (let waku = 1; waku <= 8; waku++) {
    const size = waku > doubleStart ? 2 : 1;
    count += size;
    if (horseNumber <= count) return waku;
  }
  return 8;
}

// ─── 認証（localStorage簡易版） ───
const Auth = {
  getUsers() {
    return JSON.parse(localStorage.getItem('umayose_users') || '[]');
  },
  saveUsers(users) {
    localStorage.setItem('umayose_users', JSON.stringify(users));
  },
  register(email, password) {
    const users = this.getUsers();
    if (users.find(u => u.email === email)) return { ok: false, msg: 'このメールアドレスは登録済みです' };
    users.push({ email, password });
    this.saveUsers(users);
    this.login(email, password);
    return { ok: true };
  },
  login(email, password) {
    const users = this.getUsers();
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) return { ok: false, msg: 'メールアドレスまたはパスワードが正しくありません' };
    localStorage.setItem('umayose_current', JSON.stringify({ email }));
    return { ok: true };
  },
  logout() {
    localStorage.removeItem('umayose_current');
    window.location.reload();
  },
  current() {
    const data = localStorage.getItem('umayose_current');
    return data ? JSON.parse(data) : null;
  }
};

// ─── マイ印（localStorage） ───
const MyMarks = {
  _key: 'umayose_mymarks',
  getAll() {
    return JSON.parse(localStorage.getItem(this._key) || '{}');
  },
  get(raceId, horseNumber) {
    const all = this.getAll();
    return (all[raceId] || {})[String(horseNumber)] || '';
  },
  set(raceId, horseNumber, mark) {
    const all = this.getAll();
    if (!all[raceId]) all[raceId] = {};
    if (mark) {
      all[raceId][String(horseNumber)] = mark;
    } else {
      delete all[raceId][String(horseNumber)];
    }
    localStorage.setItem(this._key, JSON.stringify(all));
  },
  toggle(raceId, horseNumber) {
    const current = this.get(raceId, horseNumber);
    const idx = MARKS.indexOf(current);
    const next = idx === -1 ? MARKS[0] : (idx === MARKS.length - 1 ? '' : MARKS[idx + 1]);
    this.set(raceId, horseNumber, next);
    return next;
  }
};

// ─── ヘルパー関数 ───

/** 馬体重の増減を色分け表示 */
function formatBodyWeight(bw) {
  if (!bw) return '';
  const match = bw.match(/^(\d+)\(([+\-]?\d+)\)$/);
  if (!match) return bw;
  const weight = match[1];
  const delta = parseInt(match[2]);
  let cls = 'bw-zero';
  if (delta > 0) cls = 'bw-plus';
  else if (delta < 0) cls = 'bw-minus';
  const sign = delta > 0 ? '+' : '';
  return `<span class="col-bodyweight">${weight}<span class="${cls}">(${sign}${delta})</span></span>`;
}

/** 着順に応じたCSSクラスを返す */
function pastRankClass(rank) {
  if (rank === 1) return 'rank-1st';
  if (rank === 2) return 'rank-2nd';
  if (rank === 3) return 'rank-3rd';
  return '';
}

/** 日付文字列を "YYYY.MM.DD 曜" 形式にフォーマット */
function formatPastDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const days = ['日','月','火','水','木','金','土'];
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dow = days[d.getDay()];
  return `${y}.${m}.${day} ${dow}`;
}

/** 1走分の過去成績をnetkeiba shutuba_past風のHTMLで返す */
function formatPastCell(p) {
  if (!p || typeof p !== 'object') return '<td class="past-cell-empty">-</td>';
  const rankCls = pastRankClass(p.rank);
  const rankDisplay = p.rank != null ? p.rank : '-';
  const popText = p.popularity != null ? `(${p.popularity}人気)` : '';
  const timeStr = p.time || '';
  const last3f = p.last3f ? ` 上${p.last3f}` : '';
  const marginStr = p.margin ? `着差${p.margin}` : '';
  const passing = p.passingOrder ? ` 通過${p.passingOrder}` : '';
  const bw = p.bodyWeight || '';

  return `<td class="past-cell ${rankCls}">
    <span class="past-data-row past-date">${formatPastDate(p.date)}</span>
    <span class="past-data-row past-race-name">${p.class || ''}</span>
    <span class="past-data-row past-course">${p.distance || ''} ${p.condition || ''}</span>
    <span class="past-data-row past-detail">${p.fieldSize || ''}頭 ${p.venue || ''} ${p.jockey || ''} ${p.weight || ''}</span>
    <span class="past-data-row past-result-line"><span class="past-rank-num">${rankDisplay}着</span>${popText} ${timeStr}${last3f}</span>
    <span class="past-data-row past-margin">${marginStr}${passing}</span>
    <span class="past-data-row past-weight">馬体重 ${bw}</span>
  </td>`;
}

/** ISO時刻を相対時間に変換（「3分前」「1時間前」形式） */
function relativeTime(isoString) {
  if (!isoString) return '';
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'たった今';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}日前`;
  return then.toLocaleDateString('ja-JP');
}

// ─── ナビバー描画 ───
function renderNav() {
  const nav = qs('#navbar');
  if (!nav) return;

  const user = Auth.current();
  const page = window.location.pathname.split('/').pop() || 'index.html';

  const activeClass = (p) => page === p ? 'active' : '';

  let userHtml;
  if (user) {
    const name = user.email.split('@')[0];
    userHtml = `
      <span class="nav-user-info">
        <span class="user-icon">${name[0].toUpperCase()}</span>
        ${name}
      </span>
      <span class="nav-logout" onclick="Auth.logout()">ログアウト</span>
    `;
  } else {
    userHtml = `<a href="login.html" class="nav-user-btn">ログイン</a>`;
  }

  nav.innerHTML = `
    <div class="container nav-container">
      <a href="index.html" class="logo">
        <span class="logo-icon"><img src="assets/logo.svg" alt="FRONT RUNNER"></span>
        <span class="logo-text">FRONT RUNNER</span>
      </a>
      <nav class="nav-links" id="navLinks">
        <a href="index.html" class="${activeClass('index.html')}">レース一覧</a>
        <a href="results.html" class="${activeClass('results.html')}">速報</a>
        <a href="hits.html" class="${activeClass('hits.html')}">的中速報</a>
        <a href="predictors.html" class="${activeClass('predictors.html')}">予想家</a>
        ${userHtml}
      </nav>
      <button class="mobile-toggle" id="mobileToggle" aria-label="メニュー">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;

  qs('#mobileToggle').addEventListener('click', () => {
    qs('#navLinks').classList.toggle('open');
  });
}

// ─── フッター描画 ───
function renderFooter() {
  const footer = qs('#footer');
  if (!footer) return;
  footer.innerHTML = `
    <div class="container footer-inner">
      <div class="footer-brand">
        <span class="logo">
          <span class="logo-icon"><img src="assets/logo.svg" alt="" style="width:24px;height:24px;"></span>
          <span class="logo-text" style="font-size:0.9rem;">FRONT RUNNER</span>
        </span>
      </div>
      <span class="footer-copy">&copy; 2026 FRONT RUNNER. All rights reserved.</span>
    </div>
  `;
}

// ─── レース一覧ページ（タブ切り替え付き） ───
async function renderRaceList() {
  const main = qs('#main');
  if (!main) return;

  main.innerHTML = '<div class="loading">レースデータを読み込み中…</div>';

  const today = new Date().toISOString().slice(0, 10);
  let data = await fetchJSON(`data/races/${today}.json`);
  if (!data) data = await fetchJSON('data/races/2026-02-16.json');

  const [predictors, hitsData] = await Promise.all([
    fetchJSON('data/predictors.json'),
    fetchJSON('data/hits.json')
  ]);

  if (!data || !data.venues) {
    main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏇</div>本日のレースデータがありません</div>';
    return;
  }

  // 重賞レース収集
  const gradeRaces = [];
  for (const venue of data.venues) {
    for (const race of venue.races) {
      if (race.grade) {
        gradeRaces.push({ ...race, _venue: venue.name });
      }
    }
  }

  // ページヘッダー
  let html = `
    <div class="page-header">
      <h1 class="page-title">
        🏇 レース一覧
        <span class="date-badge">${data.date}</span>
      </h1>
    </div>
  `;

  // 的中速報ティッカー
  html += buildHitsTickerHTML(hitsData, predictors);

  // 重賞バナー（あれば）
  if (gradeRaces.length > 0) {
    html += '<div class="grade-banner-section">';
    html += '<div class="grade-banner-grid">';
    for (const gr of gradeRaces) {
      html += `
        <a href="race.html?id=${gr.id}&date=${data.date}" class="grade-banner-card">
          <span class="grade-banner-grade ${gr.grade}">${gr.grade}</span>
          <div class="grade-banner-info">
            <div class="grade-banner-name">${gr.name}</div>
            <div class="grade-banner-meta">
              <span>${gr._venue}</span>
              <span>${gr.distance}</span>
              <span>${gr.startTime}発走</span>
            </div>
          </div>
        </a>
      `;
    }
    html += '</div></div>';
  }

  // モバイル用タブバー
  html += '<div class="venue-tabs" id="venueTabs">';
  data.venues.forEach((venue, i) => {
    const activeClass = i === 0 ? 'active' : '';
    html += `
      <button class="venue-tab ${activeClass}" data-venue-idx="${i}">
        ${venue.name}
        <span class="tab-count">${venue.races.length}</span>
      </button>
    `;
  });
  html += '</div>';

  // PC用: 3カラムグリッド / モバイル用: タブ切り替えパネル
  html += '<div class="venues-grid">';
  data.venues.forEach((venue, i) => {
    const activeClass = i === 0 ? 'active' : '';
    html += `<div class="venue-column venue-panel ${activeClass}" data-venue-panel="${i}">`;
    html += `
      <div class="venue-column-header">
        <span class="venue-name">${venue.name}</span>
        <span class="venue-badge">${venue.races.length}R</span>
      </div>
    `;
    for (const race of venue.races) {
      const gradeClass = race.grade ? `grade-${race.grade}` : '';
      const gradeTag = race.grade ? `<span class="race-grade ${race.grade}">${race.grade}</span>` : '';
      html += `
        <a href="race.html?id=${race.id}&date=${data.date}" class="race-row ${gradeClass}">
          <span class="race-row-num">${race.raceNumber}R</span>
          <span class="race-row-name">${gradeTag}${race.name}</span>
          <span class="race-row-dist">${race.distance}</span>
          <span class="race-row-time">${race.startTime}</span>
        </a>
      `;
    }
    html += '</div>';
  });
  html += '</div>';

  // 予想家セクション
  if (predictors && predictors.length > 0) {
    html += '<div class="top-predictors-section">';
    html += '<div class="top-section-title">FRONT RUNNER 厳選予想家</div>';
    html += '<div class="top-predictor-grid">';
    for (const p of predictors) {
      const initial = p.name ? p.name[0] : '?';
      if (p.comingSoon) {
        html += `
          <div class="top-predictor-card" style="opacity:0.5">
            <div class="top-predictor-avatar" style="background:${p.color}">${initial}</div>
            <div class="top-predictor-name">${p.name}</div>
            <div class="top-predictor-link">3月デビュー予定</div>
          </div>
        `;
      } else {
        html += `
          <a href="${p.profileUrl}" target="_blank" rel="noopener" class="top-predictor-card">
            <div class="top-predictor-avatar" style="background:${p.color}">${initial}</div>
            <div class="top-predictor-name">${p.name}</div>
            <div class="top-predictor-link">${p.platform} →</div>
          </a>
        `;
      }
    }
    html += '</div></div>';
  }

  // FRONT RUNNER コラムセクション（ダミー）
  const columns = [
    { title: '春のG1シーズン到来！注目はやはりあの馬', excerpt: '今年の春競馬の主役となりそうな馬たちを徹底分析。クラシック路線と古馬路線、それぞれの見どころを解説します。', date: '2026-02-15', emoji: '🏆' },
    { title: 'AI予想の的中率を検証してみた', excerpt: 'FRONT RUNNERの予想家陣のAI予想、実際の的中率はどれくらい？過去3ヶ月のデータを徹底検証。', date: '2026-02-13', emoji: '🤖' },
    { title: '初心者向け：競馬の印の読み方ガイド', excerpt: '◎○▲△って何？初心者にもわかりやすく、競馬の印（しるし）の意味と活用法を解説します。', date: '2026-02-10', emoji: '📖' }
  ];
  html += '<div class="column-section">';
  html += '<div class="top-section-title">FRONT RUNNER コラム</div>';
  html += '<div class="column-grid">';
  for (const col of columns) {
    html += `
      <div class="column-card">
        <div class="column-thumbnail">${col.emoji}</div>
        <div class="column-body">
          <div class="column-title">${col.title}</div>
          <div class="column-excerpt">${col.excerpt}</div>
          <div class="column-date">${col.date}</div>
        </div>
      </div>
    `;
  }
  html += '</div></div>';

  main.innerHTML = html;

  // モバイル用タブ切り替えイベント
  qsa('.venue-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const idx = this.dataset.venueIdx;
      qsa('.venue-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      qsa('.venue-panel').forEach(p => p.classList.remove('active'));
      const panel = qs(`[data-venue-panel="${idx}"]`);
      if (panel) panel.classList.add('active');
    });
  });
}

// ─── 予測勝率算出（擬似ハッシュ） ───
function calcWinRate(raceId, horseNumber) {
  let hash = 0;
  const str = 'winrate_' + raceId + '_' + horseNumber;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 301 + 50) / 10; // 5.0 〜 35.0
}

function winRateClass(val) {
  if (val >= 25) return 'winrate-high';
  if (val >= 15) return 'winrate-mid';
  return 'winrate-low';
}

// ─── テン指数算出（擬似ハッシュ） ───
function calcTenIndex(raceId, horseNumber) {
  let hash = 0;
  const str = raceId + '_' + horseNumber;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 401 + 300) / 10; // 30.0 〜 70.0
}

function tenIndexClass(val) {
  if (val < 40) return 'ten-front';
  if (val >= 60) return 'ten-back';
  return 'ten-middle';
}

// ─── 出馬表ページ ───
async function renderRaceDetail() {
  const main = qs('#main');
  if (!main) return;

  main.innerHTML = '<div class="loading">出馬表を読み込み中…</div>';

  const params = getParams();
  const raceId = params.id;
  const dateStr = params.date || '2026-02-16';

  if (!raceId) {
    main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div>レースが指定されていません</div>';
    return;
  }

  // レースデータ取得
  const dayData = await fetchJSON(`data/races/${dateStr}.json`);
  let race = null;
  if (dayData) {
    for (const venue of dayData.venues) {
      race = venue.races.find(r => r.id === raceId);
      if (race) { race._venue = venue.name; break; }
    }
  }

  if (!race) {
    main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div>レースが見つかりませんでした</div>';
    return;
  }

  // 予想家データ + 予想データ + 的中速報取得
  const [predictors, racePredData, hitsData] = await Promise.all([
    fetchJSON('data/predictors.json'),
    fetchJSON(`data/predictions/${raceId}.json`),
    fetchJSON('data/hits.json')
  ]);

  const totalHorses = race.horseCount;

  // ヘッダー
  const gradeTag = race.grade ? `<span class="race-grade ${race.grade}">${race.grade}</span>` : '';
  let html = `
    <div class="race-header">
      <a href="index.html" class="back-link">← レース一覧に戻る</a>
      <div class="race-header-top">
        <h1 class="race-name">${gradeTag}${race.name}</h1>
      </div>
      <div class="race-meta-detail">
        <span>📍 ${race._venue} ${race.raceNumber}R</span>
        <span>📏 ${race.distance}</span>
        <span>🕐 ${race.startTime}発走</span>
        <span>🐴 ${race.horseCount}頭</span>
      </div>
      <a href="results.html?id=${raceId}&date=${dateStr}" class="result-link-btn">📡 レース結果・速報を見る</a>
    </div>
  `;

  // 午前/午後判定（13時以降は有料コンテンツをロック）
  const currentHour = new Date().getHours();
  const isLoggedIn = !!Auth.current();
  const isPremiumLocked = currentHour >= 13 && !isLoggedIn;

  // 出馬表テーブル — netkeiba shutuba_past 風: 枠|馬番|MY印|馬情報|予測勝率|逃げ馬指数|1走前〜5走前
  html += '<div class="entries-table-wrapper"><table class="entries-table"><thead><tr>';
  html += '<th class="sticky-col col-waku">枠</th><th class="sticky-col col-umaban">馬番</th><th class="th-my-mark">MY印</th><th class="col-horse">馬情報</th>';
  html += `<th>予測勝率${isPremiumLocked ? '' : ' <span class="free-badge">FREE</span>'}</th>`;
  html += `<th class="col-ten-index">逃げ馬指数${isPremiumLocked ? '' : ' <span class="free-badge">FREE</span>'}</th>`;
  html += '<th>1走前</th><th>2走前</th><th>3走前</th><th>4走前</th><th>5走前</th>';
  html += '</tr></thead><tbody>';

  // 各馬の行
  for (let ei = 0; ei < race.entries.length; ei++) {
    const entry = race.entries[ei];
    const myMark = MyMarks.get(raceId, entry.number);
    const myMarkClass = myMark ? MARK_CLASSES[myMark] : '';

    // 枠番計算
    const wakuNum = getWakuNumber(entry.number, totalHorses);
    const waku = WAKU_COLORS[wakuNum - 1];

    html += '<tr>';
    // 枠番
    html += `<td class="sticky-col col-waku"><span class="waku-badge" style="background:${waku.bg};color:${waku.text};border:1px solid ${waku.border}">${wakuNum}</span></td>`;
    // 馬番
    html += `<td class="sticky-col col-umaban"><span class="horse-num" style="border-left:3px solid ${waku.bg === '#ffffff' ? waku.border : waku.bg}">${entry.number}</span></td>`;
    // MY印
    html += `<td class="my-mark-cell ${myMarkClass}" data-race="${raceId}" data-num="${entry.number}">${myMark}</td>`;

    // 馬情報（統合セル）
    const oddsStr = entry.odds != null ? entry.odds.toFixed(1) : '';
    const popStr = entry.popularity != null ? `${entry.popularity}番人気` : '';
    html += `<td class="horse-info-cell">
      <span class="horse-info-name">${entry.name}</span>
      <span class="horse-info-detail">${entry.sex || ''}${entry.age || ''} / ${entry.weight}kg</span>
      <span class="horse-info-detail">${entry.jockey} / ${entry.trainer || ''}</span>
      <span class="horse-info-detail">馬体重 ${formatBodyWeight(entry.bodyWeight)}</span>
      <span class="horse-info-odds">単勝 <strong>${oddsStr}倍</strong> | ${popStr}</span>
    </td>`;

    // 予測勝率
    const winRate = calcWinRate(raceId, entry.number);
    const wrCls = winRateClass(winRate);
    if (isPremiumLocked) {
      html += `<td><div class="premium-overlay"><span class="premium-lock">有料会員限定</span></div></td>`;
    } else {
      html += `<td class="winrate-cell ${wrCls}">${winRate.toFixed(1)}%</td>`;
    }

    // 逃げ馬指数
    const tenVal = calcTenIndex(raceId, entry.number);
    const tenCls = tenIndexClass(tenVal);
    if (isPremiumLocked) {
      html += `<td class="ten-index"><div class="premium-overlay"><span class="premium-lock">有料会員限定</span></div></td>`;
    } else {
      html += `<td class="ten-index ${tenCls}">${tenVal.toFixed(1)}</td>`;
    }

    // 過去5走（各走ごとに1カラム）
    const pastResults = entry.pastResults || [];
    for (let pi = 0; pi < 5; pi++) {
      if (pi < pastResults.length && pastResults[pi]) {
        html += formatPastCell(pastResults[pi]);
      } else {
        html += '<td class="past-cell-empty">-</td>';
      }
    }

    html += '</tr>';
  }

  html += '</tbody></table></div>';

  // ── モバイル用: 表示切替トグル + カードリスト ──
  const savedView = localStorage.getItem('entryViewMode') || 'card';
  html += `<div class="entries-view-toggle">
    <button class="view-toggle-btn ${savedView === 'card' ? 'active' : ''}" data-view="card">カード</button>
    <button class="view-toggle-btn ${savedView === 'table' ? 'active' : ''}" data-view="table">テーブル</button>
  </div>`;

  html += '<div class="entries-mobile">';
  for (const entry of race.entries) {
    const wakuNum = getWakuNumber(entry.number, totalHorses);
    const waku = WAKU_COLORS[wakuNum - 1];
    const borderColor = waku.bg === '#ffffff' ? waku.border : waku.bg;
    const myMark = MyMarks.get(raceId, entry.number);
    const myMarkClass = myMark ? MARK_CLASSES[myMark] : '';
    const oddsStr = entry.odds != null ? entry.odds.toFixed(1) : '-';
    const popStr = entry.popularity != null ? `${entry.popularity}人気` : '';
    const winRate = calcWinRate(raceId, entry.number);
    const wrCls = winRateClass(winRate);

    html += `<div class="entry-card" style="border-left:4px solid ${borderColor}">`;
    // ヘッダー: 枠番 馬番 馬名 | オッズ・人気
    html += `<div class="entry-card-header">
      <span class="waku-badge" style="background:${waku.bg};color:${waku.text};border:1px solid ${waku.border}">${wakuNum}</span>
      <span class="horse-num" style="border-left:3px solid ${borderColor}">${entry.number}</span>
      <span class="entry-card-name">${entry.name}</span>
      <span class="entry-card-odds">${oddsStr}倍<br>${popStr}</span>
    </div>`;
    // 詳細: 性齢/斤量、騎手/調教師、馬体重
    html += `<div class="entry-card-detail">
      ${entry.sex || ''}${entry.age || ''} / ${entry.weight}kg &nbsp; ${entry.jockey} / ${entry.trainer || ''}<br>
      馬体重 ${formatBodyWeight(entry.bodyWeight)}
    </div>`;
    // 予測勝率 + MY印
    html += '<div class="entry-card-stats">';
    if (isPremiumLocked) {
      html += '<span class="premium-lock" style="font-size:0.75rem">有料会員限定</span>';
    } else {
      html += `<span class="${wrCls}">予測勝率: <strong>${winRate.toFixed(1)}%</strong></span>`;
    }
    html += `<span class="my-mark-cell ${myMarkClass}" data-race="${raceId}" data-num="${entry.number}" style="cursor:pointer;font-size:1.1rem;font-weight:900;min-width:28px;text-align:center">${myMark}</span>`;
    html += '</div>';
    // 過去走サマリー（1行テキスト）
    const pastResults = entry.pastResults || [];
    if (pastResults.length > 0) {
      const nums = ['①','②','③','④','⑤'];
      const pastSummary = pastResults.slice(0, 5).map((p, i) => {
        if (!p) return '';
        const rank = p.rank != null ? `${p.rank}着` : '';
        return `${nums[i]}${rank}`;
      }).filter(Boolean).join(' ');
      html += `<div class="entry-card-past">${pastSummary}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // 的中速報ティッカーバナー
  html += buildHitsTickerHTML(hitsData, predictors);

  // 購入リンク（予想がある予想家はレース別リンク）
  if (predictors && predictors.length > 0) {
    // このレースに予想を出している予想家のIDセット
    const racePredictorIds = new Set();
    if (racePredData && racePredData.predictions) {
      for (const pred of racePredData.predictions) racePredictorIds.add(pred.predictorId);
    }

    html += '<div class="purchase-section"><div class="purchase-title">🔗 厳選予想家の予想を購入</div><div class="purchase-grid">';
    for (const p of predictors) {
      const initial = p.name ? p.name[0] : '?';
      if (p.comingSoon) {
        html += `
          <div class="purchase-card coming-soon">
            <span class="purchase-avatar" style="background:${p.color}">${initial}</span>
            <div class="purchase-card-body">
              <span class="purchase-name">${p.name}</span>
              <span class="coming-soon-badge">3月デビュー予定</span>
            </div>
          </div>
        `;
      } else {
        const hasPred = racePredictorIds.has(p.id);
        const linkUrl = hasPred ? `${p.profileUrl}?race=${raceId}` : p.profileUrl;
        const linkLabel = hasPred
          ? 'このレースの予想を購入 →'
          : 'アカウントを見る →';
        html += `
          <a href="${linkUrl}" target="_blank" rel="noopener" class="purchase-card">
            <span class="purchase-avatar" style="background:${p.color}">${initial}</span>
            <div class="purchase-card-body">
              <span class="purchase-name">${p.name}</span>
              <span class="purchase-platform">${linkLabel}</span>
            </div>
          </a>
        `;
      }
    }
    html += '</div></div>';
  }

  main.innerHTML = html;

  // モバイル表示切替: 初期状態設定
  if (savedView === 'table') {
    const mc = document.querySelector('.entries-mobile');
    if (mc) mc.style.display = 'none';
  } else {
    const tw = document.querySelector('.entries-table-wrapper');
    if (tw) tw.style.display = 'none';
  }
  // トグルボタンのイベント
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const view = this.dataset.view;
      localStorage.setItem('entryViewMode', view);
      document.querySelector('.entries-table-wrapper').style.display = view === 'table' ? '' : 'none';
      document.querySelector('.entries-mobile').style.display = view === 'card' ? '' : 'none';
      document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
    });
  });

  // マイ印のクリックイベント
  qsa('.my-mark-cell').forEach(cell => {
    cell.addEventListener('click', function() {
      const rid = this.dataset.race;
      const num = this.dataset.num;
      const newMark = MyMarks.toggle(rid, parseInt(num));
      this.textContent = newMark;
      this.className = 'my-mark-cell';
      if (newMark && MARK_CLASSES[newMark]) this.classList.add(MARK_CLASSES[newMark]);
    });
  });

}

// ─── 予想家一覧ページ ───
async function renderPredictors() {
  const main = qs('#main');
  if (!main) return;

  main.innerHTML = '<div class="loading">予想家データを読み込み中…</div>';

  const [predictors, hitsData] = await Promise.all([
    fetchJSON('data/predictors.json'),
    fetchJSON('data/hits.json')
  ]);

  if (!predictors || predictors.length === 0) {
    main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👤</div>予想家データがありません</div>';
    return;
  }

  let html = `
    <div class="page-header">
      <h1 class="page-title">👑 予想家一覧</h1>
      <p class="page-subtitle">FRONT RUNNERが厳選した${predictors.length}名の予想家</p>
    </div>
  `;

  // 的中速報ティッカー
  html += buildHitsTickerHTML(hitsData, predictors);

  html += '<div class="predictors-grid">';

  for (const p of predictors) {
    const initial = p.name[0];
    const linkText = p.platform === 'note' ? 'noteで見る →' : 'netkeibaで見る →';
    const comingSoonBadge = p.comingSoon ? '<span class="predictor-coming-soon">3月デビュー予定</span>' : '';
    const cardClass = p.comingSoon ? 'predictor-card predictor-coming-soon' : 'predictor-card';
    html += `
      <div class="${cardClass}">
        <div class="predictor-avatar" style="background:${p.color}">${initial}</div>
        <div class="predictor-name">${p.name}${comingSoonBadge}</div>
        <div class="predictor-platform">${p.platform}</div>
        <a href="${p.profileUrl}" target="_blank" rel="noopener" class="predictor-link">
          ${linkText}
        </a>
      </div>
    `;
  }

  html += '</div>';
  main.innerHTML = html;
}

// ─── 速報ページ（ルーター） ───
async function renderResults() {
  const params = getParams();
  if (params.id) {
    renderResultDetail(params.id, params.date);
  } else {
    renderResultsOverview();
  }
}

// ─── 速報一覧（overview） ───
async function renderResultsOverview() {
  const main = qs('#main');
  if (!main) return;

  main.innerHTML = '<div class="loading">速報データを読み込み中…</div>';

  const today = new Date().toISOString().slice(0, 10);
  let dayData = await fetchJSON(`data/races/${today}.json`);
  if (!dayData) dayData = await fetchJSON('data/races/2026-02-16.json');

  let resultsData = await fetchJSON(`data/results/${today}.json`);
  if (!resultsData) resultsData = await fetchJSON('data/results/2026-02-16.json');

  const [predictors, hitsData] = await Promise.all([
    fetchJSON('data/predictors.json'),
    fetchJSON('data/hits.json')
  ]);

  const resultsMap = {};
  if (resultsData && resultsData.results) {
    for (const r of resultsData.results) resultsMap[r.raceId] = r;
  }

  const dateStr = dayData ? dayData.date : today;

  let html = `
    <div class="page-header">
      <h1 class="page-title">
        📡 レース速報
        <span class="date-badge">${dateStr}</span>
      </h1>
    </div>
  `;

  // 的中速報ティッカー
  html += buildHitsTickerHTML(hitsData, predictors);

  if (!dayData || !dayData.venues) {
    html += '<div class="empty-state"><div class="empty-state-icon">📡</div>本日のレースデータがありません</div>';
    main.innerHTML = html;
    return;
  }

  for (const venue of dayData.venues) {
    html += `
      <div class="results-venue">
        <div class="venue-header-inline">
          <span class="venue-name">${venue.name}</span>
          <span class="venue-badge">${venue.races.length}レース</span>
        </div>
        <div class="results-list">
    `;

    for (const race of venue.races) {
      const result = resultsMap[race.id];
      const gradeTag = race.grade ? `<span class="race-grade ${race.grade}">${race.grade}</span>` : '';
      const cardClass = race.grade ? `result-card result-card-${race.grade}` : 'result-card';

      html += `<a href="results.html?id=${race.id}&date=${dateStr}" class="result-card-link ${cardClass}">`;

      // ヘッダー行
      html += `<div class="result-card-header">`;
      html += `<span class="result-race-number">${race.raceNumber}R</span>`;
      html += `<span class="result-race-name">${gradeTag}${race.name}</span>`;
      html += `<span class="result-race-meta">${race.distance}</span>`;
      html += `</div>`;

      if (result && result.placings) {
        // 着順（3着まで簡易表示）
        html += '<div class="result-body">';
        html += '<div class="result-placings-table">';
        for (const placing of result.placings.slice(0, 3)) {
          const entry = race.entries.find(e => e.number === placing.number);
          const pop = entry ? entry.popularity : '';
          html += `
            <div class="rp-row rp-rank-${placing.rank}">
              <span class="rp-rank">${placing.rank}<small>着</small></span>
              <span class="rp-num">${placing.number}</span>
              <span class="rp-name">${placing.name}</span>
              <span class="rp-pop">${pop}人気</span>
            </div>
          `;
        }
        html += '</div>';
        html += '</div>';
      } else {
        html += '<div class="result-pending">結果未確定</div>';
      }

      html += `</a>`;
    }

    html += '</div></div>';
  }

  main.innerHTML = html;
}

// ─── 個別レース結果 ───
async function renderResultDetail(raceId, dateStr) {
  const main = qs('#main');
  if (!main) return;

  main.innerHTML = '<div class="loading">レース結果を読み込み中…</div>';

  if (!dateStr) dateStr = '2026-02-16';

  // データ取得
  let dayData = await fetchJSON(`data/races/${dateStr}.json`);
  if (!dayData) dayData = await fetchJSON('data/races/2026-02-16.json');

  let resultsData = await fetchJSON(`data/results/${dateStr}.json`);
  if (!resultsData) resultsData = await fetchJSON('data/results/2026-02-16.json');

  // 予想家データ＋予想データ＋的中速報を並行取得
  const [predictors, predData, hitsData] = await Promise.all([
    fetchJSON('data/predictors.json'),
    fetchJSON(`data/predictions/${raceId}.json`),
    fetchJSON('data/hits.json')
  ]);

  const predictorMap = {};
  if (predictors) predictors.forEach(p => predictorMap[p.id] = p);

  // レース情報取得
  let race = null;
  if (dayData) {
    for (const venue of dayData.venues) {
      race = venue.races.find(r => r.id === raceId);
      if (race) { race._venue = venue.name; break; }
    }
  }

  if (!race) {
    main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div>レースが見つかりませんでした</div>';
    return;
  }

  // 結果データ取得
  let result = null;
  if (resultsData && resultsData.results) {
    result = resultsData.results.find(r => r.raceId === raceId);
  }

  const gradeTag = race.grade ? `<span class="race-grade ${race.grade}">${race.grade}</span>` : '';
  const totalHorses = race.horseCount;

  let html = `
    <div class="result-detail-header">
      <a href="results.html" class="back-link">← 速報一覧に戻る</a>
      <div class="race-header-top">
        <h1 class="race-name">${gradeTag}${race.name}</h1>
      </div>
      <div class="race-meta-detail">
        <span>📍 ${race._venue} ${race.raceNumber}R</span>
        <span>📏 ${race.distance}</span>
        <span>🕐 ${race.startTime}発走</span>
        <span>🐴 ${race.horseCount}頭</span>
      </div>
      <a href="race.html?id=${raceId}&date=${dateStr}" class="result-link-btn">📋 出馬表を見る</a>
    </div>
  `;

  // 的中速報ティッカー
  html += buildHitsTickerHTML(hitsData, predictors);

  // 予想家の印マップ構築（馬番 → [{predictorName, mark}]）
  const horseMarksMap = {}; // number -> [{name, mark}]
  if (predData && predData.predictions) {
    for (const pred of predData.predictions) {
      const p = predictorMap[pred.predictorId];
      if (!p) continue;
      for (const [numStr, mark] of Object.entries(pred.marks)) {
        const num = parseInt(numStr);
        if (!horseMarksMap[num]) horseMarksMap[num] = [];
        horseMarksMap[num].push({ name: p.name, mark });
      }
    }
  }

  if (result && result.placings) {
    html += '<div class="result-detail-body" id="resultDetailBody">';

    // 速報/確定モードトグル
    const defaultMode = result.status === 'confirmed' ? 'kakutei' : 'sokuho';
    html += '<div class="sokuho-toggle-wrapper">';
    html += `<button class="sokuho-toggle-btn ${defaultMode === 'sokuho' ? 'active' : ''}" data-mode="sokuho">速報</button>`;
    html += `<button class="sokuho-toggle-btn ${defaultMode === 'kakutei' ? 'active' : ''}" data-mode="kakutei">確定</button>`;
    html += '</div>';

    // 着順テーブル — 設計書: 着順|枠|馬番|印|馬名|性齢|騎手|厩舎|斤量|馬体重|タイム|上り|着差|オッズ|人気|通過
    html += `<div class="entries-table-wrapper"><table class="result-table" id="resultTable"><thead><tr>`;
    html += '<th>着順</th><th>枠</th><th>馬番</th><th>印</th><th class="col-horse">馬名</th>';
    html += '<th>性齢</th><th>騎手</th>';
    html += '<th class="sokuho-hide mobile-hide">厩舎</th>';
    html += '<th>斤量</th>';
    html += '<th class="sokuho-hide mobile-hide">馬体重</th>';
    html += '<th class="sokuho-hide">タイム</th><th class="sokuho-hide mobile-hide">上り</th><th class="sokuho-hide mobile-hide">着差</th>';
    html += '<th>オッズ</th><th>人気</th>';
    html += '<th class="sokuho-hide mobile-hide">通過</th>';
    html += '</tr></thead><tbody>';

    for (const placing of result.placings) {
      const entry = race.entries.find(e => e.number === placing.number);
      const jockey = entry ? entry.jockey : '';
      const pop = entry ? entry.popularity : '';
      const popClass = pop <= 3 ? `pop-${pop}` : '';
      const sexAge = entry ? `${entry.sex || ''}${entry.age || ''}` : '';
      const weightStr = entry ? entry.weight : '';
      const trainer = entry ? (entry.trainer || '') : '';
      const bodyWeight = entry ? formatBodyWeight(entry.bodyWeight) : '';
      const odds = entry && entry.odds != null ? entry.odds.toFixed(1) : '';

      // MY印 + 予想家の印
      const myMark = MyMarks.get(raceId, placing.number);
      const myMarkClass = myMark ? MARK_CLASSES[myMark] : '';
      const predictorMarks = horseMarksMap[placing.number] || [];
      const predictorTooltip = predictorMarks.map(m => `${m.name}: ${m.mark}`).join('\n');

      // 枠色計算
      const wakuNum = getWakuNumber(placing.number, totalHorses);
      const waku = WAKU_COLORS[wakuNum - 1];

      const rankClass = placing.rank <= 3 ? `rank-${placing.rank}` : '';
      const rankBadgeClass = placing.rank <= 3 ? `rank-badge-${placing.rank}` : '';

      // 上り3Fクラス
      const last3f = parseFloat(placing.last3f || 0);
      const last3fCls = last3f > 0 ? (last3f < 34.0 ? 'last3f-fast' : (last3f > 36.0 ? 'last3f-slow' : 'last3f-mid')) : '';

      html += `<tr class="${rankClass}">`;
      html += `<td><span class="result-rank-badge ${rankBadgeClass}">${placing.rank}</span></td>`;
      html += `<td><span class="waku-badge" style="background:${waku.bg};color:${waku.text};border:1px solid ${waku.border}">${wakuNum}</span></td>`;
      html += `<td><span class="horse-num" style="border-left:3px solid ${waku.bg === '#ffffff' ? waku.border : waku.bg}">${placing.number}</span></td>`;
      // 印列（MY印 + 予想家ツールチップ）
      html += `<td class="${myMarkClass}" title="${predictorTooltip}" style="font-weight:900;font-size:1.1rem;cursor:default">${myMark || ''}</td>`;
      html += `<td class="col-horse">${placing.name}</td>`;
      html += `<td class="col-sexage">${sexAge}</td>`;
      html += `<td>${jockey}</td>`;
      html += `<td class="col-trainer sokuho-hide mobile-hide">${trainer}</td>`;
      html += `<td>${weightStr}</td>`;
      html += `<td class="sokuho-hide mobile-hide">${bodyWeight}</td>`;
      html += `<td class="result-time sokuho-hide">${placing.time || ''}</td>`;
      html += `<td class="result-last3f sokuho-hide mobile-hide ${last3fCls}">${placing.last3f || ''}</td>`;
      html += `<td class="result-margin sokuho-hide mobile-hide">${placing.margin || ''}</td>`;
      html += `<td class="odds-val">${odds}</td>`;
      html += `<td><span class="pop-val ${popClass}">${pop}</span></td>`;
      html += `<td class="result-passing sokuho-hide mobile-hide">${placing.passingOrder || ''}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    // レースラップ表示
    if (result.raceLap) {
      const laps = result.raceLap.split('-').map(l => parseFloat(l));
      const avgLap = laps.reduce((a, b) => a + b, 0) / laps.length;
      html += '<div class="race-lap-section sokuho-hide">';
      html += '<div class="race-lap-title">レースラップ</div>';
      html += '<div class="race-lap-badges">';
      for (const lap of laps) {
        let lapCls = '';
        if (lap < avgLap - 0.3) lapCls = 'lap-fast';
        else if (lap > avgLap + 0.3) lapCls = 'lap-slow';
        html += `<span class="lap-badge ${lapCls}">${lap.toFixed(1)}</span>`;
      }
      html += '</div></div>';
    }

    // 払戻金テーブル（構造化）
    if (result.payouts) {
      html += '<div class="payouts-table-wrapper">';
      html += '<div class="payouts-table-title">払戻金</div>';
      html += '<table class="payouts-table"><thead><tr>';
      html += '<th>券種</th><th>組番</th><th>払戻金</th><th>人気</th>';
      html += '</tr></thead><tbody>';
      for (const payout of result.payouts) {
        const amountClass = payout.amount >= 10000 ? 'payout-amount-high' : '';
        html += '<tr>';
        html += `<td class="payout-type">${payout.type}</td>`;
        html += `<td class="payout-numbers">${payout.numbers || ''}</td>`;
        html += `<td class="payout-amount ${amountClass}">¥${payout.amount.toLocaleString()}</td>`;
        html += `<td class="payout-pop">${payout.popularity || ''}人気</td>`;
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }

    // 予想家的中情報（7種の買い目ベース）
    if (predData && predData.predictions) {
      const top3Nums = result.placings.slice(0, 3).map(p => p.number);
      const firstNum = top3Nums[0];
      const secondNum = top3Nums[1];
      const thirdNum = top3Nums[2];

      const predictorHits = {}; // predictorId -> [{type, label}]

      for (const pred of predData.predictions) {
        const p = predictorMap[pred.predictorId];
        if (!p) continue;

        const marks = pred.marks;
        const honmeiEntry = Object.entries(marks).find(([, v]) => v === '◎');
        const taikouEntry = Object.entries(marks).find(([, v]) => v === '○');
        const tanaEntry = Object.entries(marks).find(([, v]) => v === '▲');
        const renkaEntry = Object.entries(marks).find(([, v]) => v === '△');

        const honmei = honmeiEntry ? parseInt(honmeiEntry[0]) : null;
        const taikou = taikouEntry ? parseInt(taikouEntry[0]) : null;
        const tana = tanaEntry ? parseInt(tanaEntry[0]) : null;
        const renka = renkaEntry ? parseInt(renkaEntry[0]) : null;
        const markedHorses = [honmei, taikou, tana, renka].filter(n => n !== null);

        const hitList = [];

        // 単勝
        if (honmei === firstNum) hitList.push({ type: 'tansho', label: '単勝' });
        // 複勝
        if (honmei && top3Nums.includes(honmei)) hitList.push({ type: 'fukusho', label: '複勝' });
        // 馬連
        if (honmei && taikou) {
          const pair = [honmei, taikou].sort((a, b) => a - b);
          const topPair = [firstNum, secondNum].sort((a, b) => a - b);
          if (pair[0] === topPair[0] && pair[1] === topPair[1]) hitList.push({ type: 'umaren', label: '馬連' });
        }
        // 馬単
        if (honmei === firstNum && taikou === secondNum) hitList.push({ type: 'umatan', label: '馬単' });
        // ワイド
        {
          const inTop3 = markedHorses.filter(n => top3Nums.includes(n));
          if (inTop3.length >= 2) hitList.push({ type: 'wide', label: 'ワイド' });
        }
        // 3連複
        if (honmei && taikou && tana && [honmei, taikou, tana].every(n => top3Nums.includes(n))) {
          hitList.push({ type: 'sanrenpuku', label: '3連複' });
        }
        // 3連単
        if (honmei === firstNum && taikou === secondNum && tana === thirdNum) {
          hitList.push({ type: 'sanrentan', label: '3連単' });
        }

        if (hitList.length > 0) {
          predictorHits[pred.predictorId] = { predictor: p, hits: hitList };
        }
      }

      const hitEntries = Object.values(predictorHits);
      if (hitEntries.length > 0) {
        html += '<div class="result-hits-enhanced">';
        html += '<div class="result-hits-title">予想家的中</div>';
        for (const { predictor, hits } of hitEntries) {
          const initial = predictor.name[0];
          html += '<div class="result-hit-row">';
          html += `<span class="result-hit-avatar" style="background:${predictor.color}">${initial}</span>`;
          html += `<span class="result-hit-name">${predictor.name}</span>`;
          html += '<span class="result-hit-badges">';
          for (const h of hits) {
            html += `<span class="result-hit-badge result-hit-badge-${h.type}">${h.label}</span>`;
          }
          html += '</span></div>';
        }
        html += '</div>';
      }
    }

    // SNSシェアボタン
    const top3Placings = result.placings.slice(0, 3);
    // MY印との照合テキスト生成
    let shareLines = [];
    for (const p of top3Placings) {
      const mk = MyMarks.get(raceId, p.number);
      if (mk) shareLines.push(`${mk}${p.name} → ${p.rank}着`);
    }
    const shareText = shareLines.length > 0
      ? `【FRONT RUNNER】${race.name}\n${shareLines.join('\n')}\n#FRONTRUNNER #競馬`
      : `【FRONT RUNNER】${race.name} 結果\n1着: ${top3Placings[0]?.name || ''}\n2着: ${top3Placings[1]?.name || ''}\n3着: ${top3Placings[2]?.name || ''}\n#FRONTRUNNER #競馬`;
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    html += '<div class="sns-share-section">';
    html += `<a href="${twitterUrl}" target="_blank" rel="noopener" class="sns-share-btn sns-share-btn-x">𝕏 結果をシェア</a>`;
    html += '</div>';

    html += '</div>'; // .result-detail-body
  } else {
    html += '<div class="result-pending">結果未確定</div>';
  }

  main.innerHTML = html;

  // 速報/確定モード切替イベント
  qsa('.sokuho-toggle-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      qsa('.sokuho-toggle-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const body = qs('#resultDetailBody');
      if (!body) return;
      if (this.dataset.mode === 'sokuho') {
        body.classList.add('sokuho-mode');
      } else {
        body.classList.remove('sokuho-mode');
      }
    });
  });

  // デフォルトモード適用
  if (result && result.status !== 'confirmed') {
    const body = qs('#resultDetailBody');
    if (body) body.classList.add('sokuho-mode');
  }
}

// ─── 的中速報ページ ───
async function renderHitsBoard() {
  const main = qs('#main');
  if (!main) return;

  main.innerHTML = '<div class="loading">的中速報を読み込み中…</div>';

  const [hitsData, predictors] = await Promise.all([
    fetchJSON('data/hits.json'),
    fetchJSON('data/predictors.json')
  ]);

  if (!hitsData || !hitsData.hits || hitsData.hits.length === 0) {
    main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎯</div>的中速報データがありません</div>';
    return;
  }

  // 予想家マップ
  const predictorMap = {};
  if (predictors) predictors.forEach(p => predictorMap[p.id] = p);

  const hits = hitsData.hits;

  // サマリー計算
  const totalHits = hits.length;
  const totalPayout = hits.reduce((sum, h) => sum + h.payoutAmount, 0);
  const maxPayout = Math.max(...hits.map(h => h.payoutAmount));

  // フィルター用データ収集
  const hitTypes = [...new Set(hits.map(h => h.hitType))];
  const hitPredictors = [...new Set(hits.map(h => h.predictorId))];

  const hitTypeLabels = {
    tansho: '単勝', fukusho: '複勝', umaren: '馬連', umatan: '馬単',
    wide: 'ワイド', sanrenpuku: '3連複', sanrentan: '3連単'
  };

  let html = `
    <div class="page-header hits-header">
      <h1 class="page-title">🎯 的中速報</h1>
      <p class="page-subtitle">予想家の的中情報をリアルタイムで配信</p>
    </div>
  `;

  // 的中速報ティッカー（データなし時は非表示）
  html += buildHitsTickerHTML(hitsData, predictors, { showFallback: false });

  html += `
    <div class="hits-summary">
      <div class="hits-summary-card">
        <div class="hits-summary-value hits-summary-count">${totalHits}</div>
        <div class="hits-summary-label">的中件数</div>
      </div>
      <div class="hits-summary-card">
        <div class="hits-summary-value hits-summary-payout">¥${totalPayout.toLocaleString()}</div>
        <div class="hits-summary-label">総払戻金額</div>
      </div>
      <div class="hits-summary-card">
        <div class="hits-summary-value hits-summary-max">¥${maxPayout.toLocaleString()}</div>
        <div class="hits-summary-label">最高額的中</div>
      </div>
    </div>

    <div class="hits-filter-section">
      <div class="hits-filters">
        <button class="hit-filter-btn active" data-filter="all" data-group="type">すべて</button>
  `;

  // 券種フィルター
  for (const type of hitTypes) {
    html += `<button class="hit-filter-btn" data-filter="${type}" data-group="type">${hitTypeLabels[type] || type}</button>`;
  }

  html += '</div>';

  // 予想家フィルター
  html += '<div class="hits-filters">';
  html += '<button class="hit-filter-btn active" data-filter="all" data-group="predictor">全予想家</button>';
  for (const pid of hitPredictors) {
    const p = predictorMap[pid];
    const name = p ? p.name : pid;
    html += `<button class="hit-filter-btn" data-filter="${pid}" data-group="predictor">${name}</button>`;
  }
  html += '</div></div>';

  // タイムライン（グリッド）
  html += '<div class="hits-timeline" id="hitsTimeline">';

  for (const hit of hits) {
    const p = predictorMap[hit.predictorId];
    const name = p ? p.name : hit.predictorId;
    const color = p ? p.color : '#999';
    const initial = name ? name[0] : '?';
    const profileUrl = p ? p.profileUrl : '#';
    const isJackpot = hit.payoutAmount >= 10000;
    const cardClass = isJackpot ? 'hit-card hit-card-jackpot' : 'hit-card';
    const payoutClass = isJackpot ? 'hit-card-payout hit-card-payout-jackpot' : 'hit-card-payout';

    const gradeTag = hit.grade ? `<span class="hit-grade ${hit.grade}">${hit.grade}</span>` : '';
    const horseDisplay = hit.hitHorseNumber
      ? `<span class="horse-num" style="margin-right:6px">${hit.hitHorseNumber}</span>${hit.hitHorseName}`
      : hit.hitHorseName;

    // 日付フォーマット
    const hitDate = new Date(hit.timestamp);
    const dateStr = `${hitDate.getFullYear()}/${hitDate.getMonth() + 1}/${hitDate.getDate()}`;

    html += `
      <div class="${cardClass}" data-type="${hit.hitType}" data-predictor="${hit.predictorId}">
        <span class="hit-card-avatar" style="background:${color}">${initial}</span>
        <div class="hit-card-body">
          <div class="hit-card-top">
            <span class="hit-card-name">${name}</span>
            <span class="hit-mark-badge" data-type="${hit.hitType}">${hit.hitLabel}</span>
          </div>
          <div class="hit-card-race">
            ${gradeTag}${dateStr} ${hit.venue} ${hit.raceNumber}R ${hit.raceName}
          </div>
          <div class="hit-card-result">
            <span class="hit-card-horse">${horseDisplay}</span>
            <span class="${payoutClass}">¥${hit.payoutAmount.toLocaleString()}</span>
          </div>
          <div class="hit-card-footer">
            <span class="hit-card-time">${relativeTime(hit.timestamp)}</span>
            <a href="${profileUrl}" target="_blank" rel="noopener" class="hit-card-link">予想を見る →</a>
          </div>
        </div>
      </div>
    `;
  }

  html += '</div>';
  main.innerHTML = html;

  // フィルターイベント
  let activeTypeFilter = 'all';
  let activePredictorFilter = 'all';

  function applyFilters() {
    const cards = qsa('.hit-card');
    cards.forEach(card => {
      const type = card.dataset.type;
      const predictor = card.dataset.predictor;
      const typeMatch = activeTypeFilter === 'all' || type === activeTypeFilter;
      const predMatch = activePredictorFilter === 'all' || predictor === activePredictorFilter;
      card.style.display = (typeMatch && predMatch) ? '' : 'none';
    });
  }

  qsa('.hit-filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const group = this.dataset.group;
      const filter = this.dataset.filter;

      // 同グループのアクティブを解除
      qsa(`.hit-filter-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      if (group === 'type') activeTypeFilter = filter;
      else if (group === 'predictor') activePredictorFilter = filter;

      applyFilters();
    });
  });
}

// ─── 認証ページ ───
function initLogin() {
  const form = qs('#loginForm');
  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const email = qs('#loginEmail').value.trim();
    const password = qs('#loginPassword').value;
    const msgEl = qs('#loginMsg');

    if (!email || !password) {
      msgEl.className = 'auth-message error';
      msgEl.textContent = 'メールアドレスとパスワードを入力してください';
      return;
    }

    const result = Auth.login(email, password);
    if (result.ok) {
      window.location.href = 'index.html';
    } else {
      msgEl.className = 'auth-message error';
      msgEl.textContent = result.msg;
    }
  });
}

function initRegister() {
  const form = qs('#registerForm');
  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const email = qs('#regEmail').value.trim();
    const password = qs('#regPassword').value;
    const confirm = qs('#regConfirm').value;
    const msgEl = qs('#registerMsg');

    if (!email || !password) {
      msgEl.className = 'auth-message error';
      msgEl.textContent = '全てのフィールドを入力してください';
      return;
    }
    if (password.length < 4) {
      msgEl.className = 'auth-message error';
      msgEl.textContent = 'パスワードは4文字以上で入力してください';
      return;
    }
    if (password !== confirm) {
      msgEl.className = 'auth-message error';
      msgEl.textContent = 'パスワードが一致しません';
      return;
    }

    const result = Auth.register(email, password);
    if (result.ok) {
      window.location.href = 'index.html';
    } else {
      msgEl.className = 'auth-message error';
      msgEl.textContent = result.msg;
    }
  });
}

// ─── 初期化 ───
document.addEventListener('DOMContentLoaded', () => {
  renderNav();
  renderFooter();

  const page = window.location.pathname.split('/').pop() || 'index.html';

  switch (page) {
    case 'index.html':
    case '':
      renderRaceList().catch(console.error);
      break;
    case 'race.html':
      renderRaceDetail().catch(console.error);
      break;
    case 'results.html':
      renderResults().catch(console.error);
      break;
    case 'hits.html':
      renderHitsBoard().catch(console.error);
      break;
    case 'predictors.html':
      renderPredictors().catch(console.error);
      break;
    case 'login.html':
      initLogin();
      break;
    case 'register.html':
      initRegister();
      break;
  }
});
