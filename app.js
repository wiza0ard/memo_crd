/* ============================================================
   memo_crd - 공통 모듈
   GitHub API + Qcode + 디바운스 + 공통 유틸
   Copyright © 2026 wiza0ard. All rights reserved.
   ============================================================ */

// ===== 1. GitHub API 모듈 =====
const GH_REPO = 'memo_crd';

const GitHub = {
  cfg: null, // { owner, token }
  shaCache: {},

  loadCfg() {
    const raw = localStorage.getItem('memo_crd_github');
    if (!raw) { this.cfg = null; return null; }
    try {
      this.cfg = JSON.parse(raw);
      return this.cfg;
    } catch { this.cfg = null; return null; }
  },

  saveCfg(cfg) {
    this.cfg = cfg;
    localStorage.setItem('memo_crd_github', JSON.stringify(cfg));
  },

  async resolveOwner(token) {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error(`토큰 인증 실패 (${res.status})`);
    const json = await res.json();
    return json.login;
  },

  apiBase() {
    return `https://api.github.com/repos/${this.cfg.owner}/${GH_REPO}/contents`;
  },

  encode(str) { return btoa(unescape(encodeURIComponent(str))); },
  decode(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, '')))); },

  async getFile(path) {
    const token = this.cfg.token;
    const url = `${this.apiBase()}/${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (res.status === 404) return { data: null, sha: null, notFound: true };
    if (!res.ok) throw new Error(`GET ${path} 실패: ${res.status}`);
    const meta = await res.json();
    this.shaCache[path] = meta.sha;
    let content = meta.content || '';
    try {
      return { data: JSON.parse(this.decode(content)), sha: meta.sha };
    } catch (e) {
      // content가 잘렸을 경우 blob API로 재시도
      const blobRes = await fetch(
        `https://api.github.com/repos/${this.cfg.owner}/${GH_REPO}/git/blobs/${meta.sha}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
      );
      if (!blobRes.ok) throw new Error(`blob GET ${path} 실패: ${blobRes.status}`);
      const blob = await blobRes.json();
      return { data: JSON.parse(this.decode(blob.content)), sha: meta.sha };
    }
  },

  async putFile(path, dataObj, message) {
    const token = this.cfg.token;
    const url = `${this.apiBase()}/${path}`;
    const body = {
      message: message || `update ${path}`,
      content: this.encode(JSON.stringify(dataObj, null, 2))
    };
    if (this.shaCache[path]) body.sha = this.shaCache[path];

    let res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.status === 409 || res.status === 422) {
      const fresh = await this.getFile(path);
      body.sha = fresh.sha;
      res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
    if (!res.ok) throw new Error(`PUT ${path} 실패: ${res.status}`);
    const json = await res.json();
    this.shaCache[path] = json.content.sha;
    return json;
  },

  async uploadRaw(file, filename, isImage = false) {
    const token = this.cfg.token;
    const url = `${this.apiBase()}/raw/${filename}`;
    const b64 = isImage ? await imageToJpegBase64(file) : await fileToBase64(file);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `raw ${filename}`, content: b64 })
    });
    if (!res.ok) throw new Error(`업로드 실패 ${res.status}`);
    return filename;
  },

  async listRaw() {
    const token = this.cfg.token;
    const url = `${this.apiBase()}/raw`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`raw 목록 조회 실패 ${res.status}`);
    return await res.json();
  }
};

// ===== 2. 이미지/파일 변환 유틸 =====
function imageToJpegBase64(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (!blob) { rej(new Error('JPEG 변환 실패')); return; }
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(blob);
      }, 'image/jpeg', 0.91);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function fileExt(filename) {
  const m = filename.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : 'bin';
}

// ===== 3. Qcode 생성기 =====
function getFirstSunday(y) {
  const j = new Date(y, 0, 1);
  const d = j.getDay();
  const s = new Date(j);
  s.setDate(j.getDate() - (d === 0 ? 0 : d));
  return s;
}

function getWeekNum(d) {
  const fs = getFirstSunday(d.getFullYear());
  return Math.floor((d - fs) / 86400000 / 7) + 1;
}

function buildQcode(d) {
  const yy = String(d.getFullYear()).slice(-2);
  const ww = String(getWeekNum(d)).padStart(2, '0');
  const dow = d.getDay();
  const hh = String(d.getHours()).padStart(2, '0');
  const t = Math.floor(d.getMinutes() / 10);
  return `${yy}w${ww}${dow}v${hh}${t}`;
}

function qcodeLabel(qc) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const m = qc.match(/^(\d{2})w(\d{2})(\d)v(\d{2})(\d)$/);
  if (!m) return qc;
  const [, yy, ww, d, hh, t] = m;
  return `20${yy}년 ${+ww}주차 ${days[+d]}요일 ${hh}:${t}0`;
}

function weekKey(qc) {
  const m = qc.match(/^(\d{2}w\d{2})/);
  return m ? m[1] : '';
}

// ===== 4. 디바운스 저장 큐 =====
const SaveQueue = {
  pending: {},
  timer: null,
  DELAY: 1500,

  schedule(path, data, message) {
    this.pending[path] = { data, message };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.DELAY);
  },

  async flush() {
    const entries = Object.entries(this.pending);
    if (entries.length === 0) return;
    this.pending = {};
    try {
      for (const [path, { data, message }] of entries) {
        await GitHub.putFile(path, data, message);
      }
    } catch (e) {
      console.error('저장 실패:', e);
      showToast(e.message, true);
    }
  },

  async flushNow() {
    clearTimeout(this.timer);
    await this.flush();
  }
};

// ===== 5. 공통 UI 유틸 =====
let toastTimer = null;

function showToast(text, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'toast' + (isError ? ' error' : '');
  div.textContent = text;
  container.appendChild(div);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => div.remove(), 3500);
}

function showConfirm(text, onYes) {
  const modal = document.getElementById('confirm-modal');
  if (!modal) return;
  document.getElementById('confirm-text').textContent = text;
  modal.classList.remove('hidden');
  const yes = document.getElementById('confirm-yes');
  const no = document.getElementById('confirm-no');
  const cleanup = () => {
    modal.classList.add('hidden');
    yes.removeEventListener('click', onYesClick);
    no.removeEventListener('click', onNoClick);
  };
  const onYesClick = () => { cleanup(); onYes(); };
  const onNoClick = () => { cleanup(); };
  yes.addEventListener('click', onYesClick);
  no.addEventListener('click', onNoClick);
}

function setSyncStatus(state, text) {
  const ind = document.getElementById('sync-indicator');
  const txt = document.getElementById('sync-text');
  if (ind) {
    ind.classList.remove('syncing', 'error');
    if (state === 'syncing' || state === 'pending') ind.classList.add('syncing');
    if (state === 'error') ind.classList.add('error');
  }
  if (txt) txt.textContent = text || '';
}

function setStatusText(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

// ===== 6. 데이터 상수 =====
const FILES = {
  cards: 'cards.json',
  scores: 'scores.json',
  weekly: 'weekly_stats.json',
  schemas: 'field_schemas.json'
};

// ===== 7. 설정 모달 =====
async function saveSetup() {
  const token = document.getElementById('input-token').value.trim();
  const errEl = document.getElementById('setup-error');
  const btn = document.getElementById('setup-save-btn');
  if (!token) { errEl.textContent = '토큰을 입력하세요.'; errEl.classList.remove('hidden'); return; }
  btn.disabled = true;
  btn.textContent = '확인 중...';
  errEl.classList.add('hidden');
  try {
    const owner = await GitHub.resolveOwner(token);
    GitHub.saveCfg({ owner, token });
    closeSetup();
    await loadAllData();
    if (typeof renderIndex === 'function') renderIndex();
    if (typeof renderControl === 'function') renderControl();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '시작하기';
  }
}

function closeSetup() {
  const modal = document.getElementById('setup-modal');
  if (modal) modal.classList.add('hidden');
}

function openSetup() {
  const modal = document.getElementById('setup-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const cfg = GitHub.loadCfg();
  if (cfg && cfg.token) {
    document.getElementById('input-token').value = cfg.token;
  }
}

// ===== 8. 데이터 로드 =====
let cardsData = [];
let scoresData = {};
let weeklyData = {};
let schemasData = {};
let currentDeck = '영어단어';
let currentIndex = 0;
let currentCard = null;
let rotation = 0;
let isFlipped = false;

async function loadAllData(silent = false) {
  if (!silent) setSyncStatus('syncing', '데이터 로드 중...');
  try {
    const [cardsRes, scoresRes, weeklyRes, schemasRes] = await Promise.all([
      GitHub.getFile(FILES.cards),
      GitHub.getFile(FILES.scores),
      GitHub.getFile(FILES.weekly),
      GitHub.getFile(FILES.schemas)
    ]);

    cardsData = cardsRes.notFound ? [] : cardsRes.data;
    scoresData = scoresRes.notFound ? {} : scoresRes.data;
    weeklyData = weeklyRes.notFound ? {} : weeklyRes.data;
    schemasData = schemasRes.notFound ? {} : schemasRes.data;

    if (!silent) setSyncStatus('ok', `${cardsData.length}개 카드 로드됨`);
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) { setSyncStatus('error', '로드 실패'); showToast(e.message, true); }
    return false;
  }
}

// ===== 9. index.html 전용 =====
let deckKeys = [];

function initIndex() {
  const cfg = GitHub.loadCfg();
  if (!cfg || !cfg.token) {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('setup-modal').classList.remove('hidden');
    document.getElementById('setup-save-btn').addEventListener('click', saveSetup);
    return;
  }
  document.getElementById('setup-modal').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // 이벤트 바인딩
  document.getElementById('nextBtn').addEventListener('click', nextCard);
  document.getElementById('prevBtn').addEventListener('click', prevCard);
  document.getElementById('shuffleBtn').addEventListener('click', shuffleDeck);
  document.getElementById('resetBtn').addEventListener('click', resetScores);
  document.getElementById('deleteBtn').addEventListener('click', deleteCurrentCard);
  document.getElementById('copyBtn').addEventListener('click', copyCurrentWord);
  document.getElementById('refreshBtn').addEventListener('click', () => { loadAllData(false).then(renderIndex); });
  document.getElementById('settingsBtn').addEventListener('click', openSetup);

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', function() {
      const action = this.dataset.action;
      if (action === 'add-star') addStar();
      else if (action === 'remove-star') removeStar();
      else if (action === 'add-x') addX();
      else if (action === 'remove-x') removeX();
    });
  });

  // 키보드 단축키
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key;
    if (key === 'ArrowRight' || key === ' ') { e.preventDefault(); nextCard(); }
    else if (key === 'ArrowLeft') { e.preventDefault(); prevCard(); }
    else if (key === '+') { e.preventDefault(); addStar(); }
    else if (key === '-') { e.preventDefault(); removeStar(); }
    else if (key === 'x' || key === 'X') { e.preventDefault(); addX(); }
    else if (key === 'c' || key === 'C') { e.preventDefault(); removeX(); }
    else if (key === 'r' || key === 'R') { e.preventDefault(); removeStar(); }
    else if (key === 'v' || key === 'V') { e.preventDefault(); copyCurrentWord(); }
  });

  // 토큰 저장 버튼
  document.getElementById('setup-save-btn').addEventListener('click', saveSetup);

  loadAllData(false).then(() => {
    renderIndex();
  });

  // visibilitychange 자동 동기화
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadAllData(true).then(() => renderIndex());
    }
  });
}

// 렌더링: 덱 탭 + 현재 카드
function renderIndex() {
  if (!cardsData.length) {
    document.getElementById('cardTitle').textContent = '📭 카드가 없습니다';
    document.getElementById('cardInner').innerHTML = `<div class="face empty-face">카드를 추가해 주세요</div>`;
    document.getElementById('progressDisplay').textContent = '0 / 0';
    return;
  }

  // 덱 목록 추출
  const decks = [...new Set(cardsData.map(c => c.deck || '기타'))];
  deckKeys = decks;
  const tabsEl = document.getElementById('deckTabs');
  tabsEl.innerHTML = decks.map(d =>
    `<button class="deck-tab ${d === currentDeck ? 'active' : ''}" data-deck="${d}">${d}</button>`
  ).join('');
  tabsEl.querySelectorAll('.deck-tab').forEach(btn => {
    btn.addEventListener('click', function() {
      currentDeck = this.dataset.deck;
      currentIndex = 0;
      renderIndex();
    });
  });

  // 현재 덱의 카드 목록
  const deckCards = cardsData.filter(c => (c.deck || '기타') === currentDeck);
  if (!deckCards.length) {
    document.getElementById('cardTitle').textContent = '📭 이 덱에 카드가 없습니다';
    document.getElementById('cardInner').innerHTML = `<div class="face empty-face">카드를 추가해 주세요</div>`;
    document.getElementById('progressDisplay').textContent = '0 / 0';
    return;
  }

  if (currentIndex >= deckCards.length) currentIndex = 0;
  if (currentIndex < 0) currentIndex = deckCards.length - 1;

  currentCard = deckCards[currentIndex];
  const stages = currentCard.stages || [];

  // 카드 렌더링
  renderCardFaces(stages);

  // 정보 패널 업데이트
  const title = getCardTitle(currentCard);
  document.getElementById('cardTitle').textContent = title || '-';
  const sub = getCardSub(currentCard);
  document.getElementById('cardSub').textContent = sub || '';

  // ★/❌ 표시
  const score = scoresData[currentCard.id] || { star: 0, x: 0 };
  document.getElementById('starDisplay').textContent = '★'.repeat(score.star || 0) + '☆'.repeat(5 - (score.star || 0));
  document.getElementById('xDisplay').textContent = '❌'.repeat(score.x || 0) + '○'.repeat(2 - (score.x || 0));

  // 진행률
  document.getElementById('progressDisplay').textContent = `${currentIndex + 1} / ${deckCards.length}`;

  // stage indicator
  const totalStages = stages.length || 1;
  const currentStage = Math.floor(((rotation / 180) % totalStages + totalStages) % totalStages);
  const indicator = document.getElementById('stageIndicator');
  indicator.textContent = Array.from({ length: totalStages }, (_, i) =>
    i === currentStage ? '●' : '○'
  ).join('');

  // 통계
  updateFooterStats(deckCards);

  // 카드 클릭 이벤트 (좌/우 분할)
  const cardEl = document.getElementById('flashCard');
  cardEl.onclick = null;
  cardEl.addEventListener('click', function(e) {
    const rect = this.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (e.clientX > centerX) {
      flipNext();
    } else {
      flipPrev();
    }
  });

  // 터치 지원
  cardEl.addEventListener('touchstart', function(e) {
    const touch = e.touches[0];
    const rect = this.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (touch.clientX > centerX) {
      flipNext();
    } else {
      flipPrev();
    }
    e.preventDefault();
  }, { passive: false });

  rotation = 0;
  applyRotation(stages.length || 1);
}

function renderCardFaces(stages) {
  const inner = document.getElementById('cardInner');
  if (!stages.length) {
    inner.innerHTML = `<div class="face">(내용 없음)</div>`;
    return;
  }
  inner.innerHTML = stages.map((stage, i) => {
    const fields = stage.fields || {};
    let content = '';
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        content += value.map(v => `<div class="field-item">${escHtml(v)}</div>`).join('');
      } else if (typeof value === 'object' && value !== null) {
        content += `<div class="field-item">${escHtml(JSON.stringify(value))}</div>`;
      } else {
        content += `<div class="field-item">${escHtml(String(value))}</div>`;
      }
    }
    const label = stage.label || `${i + 1}면`;
    return `<div class="face face-${i}" style="transform: rotateY(${i * 180}deg);">
      <div class="face-label">${escHtml(label)}</div>
      <div class="face-content">${content || '(내용 없음)'}</div>
    </div>`;
  }).join('');
}

function getCardTitle(card) {
  if (!card || !card.stages || !card.stages.length) return '-';
  const firstStage = card.stages[0];
  if (!firstStage.fields) return '-';
  const fields = firstStage.fields;
  // 우선순위: headword > word > problem_img > 첫 번째 텍스트 필드
  if (fields.headword) return fields.headword;
  if (fields.word) return fields.word;
  if (fields.problem_img) return '📷 문제';
  const firstVal = Object.values(fields).find(v => typeof v === 'string' && v.length > 0);
  return firstVal || '-';
}

function getCardSub(card) {
  if (!card || !card.stages) return '';
  const parts = [];
  if (card.baseWord) parts.push(card.baseWord);
  // 난이도 추출 (entries에서 첫 번째 difficulty)
  for (const stage of card.stages) {
    if (stage.fields && stage.fields.entries && Array.isArray(stage.fields.entries)) {
      const first = stage.fields.entries[0];
      if (first && first.difficulty) {
        parts.push(`L${first.difficulty}`);
        break;
      }
    }
  }
  if (card.deck && card.deck !== currentDeck) parts.push(card.deck);
  return parts.join(' · ');
}

function escHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyRotation(totalStages) {
  const inner = document.getElementById('cardInner');
  if (!inner) return;
  inner.style.transform = `rotateY(${rotation}deg)`;
  const currentStage = Math.floor(((rotation / 180) % totalStages + totalStages) % totalStages);
  const indicator = document.getElementById('stageIndicator');
  if (indicator) {
    indicator.textContent = Array.from({ length: totalStages }, (_, i) =>
      i === currentStage ? '●' : '○'
    ).join('');
  }
}

function flipNext() {
  const stages = currentCard ? (currentCard.stages || []) : [];
  const totalStages = stages.length || 1;
  rotation += 180;
  applyRotation(totalStages);
}

function flipPrev() {
  const stages = currentCard ? (currentCard.stages || []) : [];
  const totalStages = stages.length || 1;
  rotation -= 180;
  applyRotation(totalStages);
}

function getDeckCards() {
  return cardsData.filter(c => (c.deck || '기타') === currentDeck);
}

function nextCard() {
  const deckCards = getDeckCards();
  if (!deckCards.length) { showToast('카드가 없습니다', true); return; }
  // 가중치 랜덤 (★/❌ 반영)
  const weighted = deckCards.map(c => {
    const s = scoresData[c.id] || { star: 0, x: 0 };
    const weight = Math.max(0.1, 1.0 + (s.star || 0) * 2.0 - (s.x || 0) * 0.5);
    return { card: c, weight };
  });
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  let r = Math.random() * totalWeight;
  let selected = weighted[weighted.length - 1];
  for (const item of weighted) {
    r -= item.weight;
    if (r <= 0) { selected = item; break; }
  }
  currentIndex = deckCards.indexOf(selected.card);
  rotation = 0;
  renderIndex();
}

function prevCard() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;
  currentIndex = (currentIndex - 1 + deckCards.length) % deckCards.length;
  rotation = 0;
  renderIndex();
}

function shuffleDeck() {
  const deckCards = getDeckCards();
  if (deckCards.length < 2) { showToast('셔플할 카드가 충분하지 않습니다'); return; }
  for (let i = deckCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deckCards[i], deckCards[j]] = [deckCards[j], deckCards[i]];
  }
  // cardsData에서 해당 덱의 순서를 업데이트
  const allCards = cardsData.filter(c => (c.deck || '기타') !== currentDeck);
  const sorted = deckCards.map(c => c.id);
  cardsData = allCards.concat(deckCards);
  // 순서 유지를 위해 cardsData 재정렬
  cardsData.sort((a, b) => {
    const ia = sorted.indexOf(a.id);
    const ib = sorted.indexOf(b.id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  currentIndex = 0;
  SaveQueue.schedule(FILES.cards, cardsData, 'shuffle');
  renderIndex();
  showToast('🔀 셔플 완료');
}

function resetScores() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;
  showConfirm('현재 덱의 모든 ★/❌을 초기화하시겠습니까?', () => {
    for (const card of deckCards) {
      scoresData[card.id] = { star: 0, x: 0 };
    }
    SaveQueue.schedule(FILES.scores, scoresData, 'reset scores');
    renderIndex();
    showToast('★/❌ 초기화 완료');
  });
}

function addStar() {
  if (!currentCard) return;
  if (!scoresData[currentCard.id]) scoresData[currentCard.id] = { star: 0, x: 0 };
  const s = scoresData[currentCard.id];
  if (s.star < 5) s.star += 1;
  SaveQueue.schedule(FILES.scores, scoresData, `★+ ${currentCard.id}`);
  renderIndex();
}

function removeStar() {
  if (!currentCard) return;
  if (!scoresData[currentCard.id]) scoresData[currentCard.id] = { star: 0, x: 0 };
  const s = scoresData[currentCard.id];
  if (s.star > 0) s.star -= 1;
  SaveQueue.schedule(FILES.scores, scoresData, `★- ${currentCard.id}`);
  renderIndex();
}

function addX() {
  if (!currentCard) return;
  if (!scoresData[currentCard.id]) scoresData[currentCard.id] = { star: 0, x: 0 };
  const s = scoresData[currentCard.id];
  if (s.x < 2) s.x += 1;
  SaveQueue.schedule(FILES.scores, scoresData, `❌+ ${currentCard.id}`);
  renderIndex();
}

function removeX() {
  if (!currentCard) return;
  if (!scoresData[currentCard.id]) scoresData[currentCard.id] = { star: 0, x: 0 };
  const s = scoresData[currentCard.id];
  if (s.x > 0) s.x -= 1;
  SaveQueue.schedule(FILES.scores, scoresData, `❌- ${currentCard.id}`);
  renderIndex();
}

function deleteCurrentCard() {
  if (!currentCard) return;
  showConfirm(`"${getCardTitle(currentCard)}" 카드를 삭제하시겠습니까?`, () => {
    cardsData = cardsData.filter(c => c.id !== currentCard.id);
    delete scoresData[currentCard.id];
    SaveQueue.schedule(FILES.cards, cardsData, `delete ${currentCard.id}`);
    SaveQueue.schedule(FILES.scores, scoresData, `remove score ${currentCard.id}`);
    currentIndex = 0;
    currentCard = null;
    renderIndex();
    showToast('🗑️ 삭제 완료');
  });
}

function copyCurrentWord() {
  if (!currentCard) return;
  const title = getCardTitle(currentCard);
  if (!title) return;
  navigator.clipboard.writeText(title).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = title;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
  showToast(`📋 '${title}' 복사됨`);
}

function updateFooterStats(deckCards) {
  const el = document.getElementById('footerStats');
  if (!el) return;
  const total = deckCards.length;
  const byLevel = {};
  for (const card of deckCards) {
    let level = '기타';
    for (const stage of (card.stages || [])) {
      if (stage.fields && stage.fields.entries && Array.isArray(stage.fields.entries)) {
        for (const entry of stage.fields.entries) {
          if (entry.difficulty) {
            level = entry.difficulty;
            break;
          }
        }
        if (level !== '기타') break;
      }
    }
    byLevel[level] = (byLevel[level] || 0) + 1;
  }
  const parts = Object.entries(byLevel).map(([k, v]) => `L${k}: ${v}개`);
  el.textContent = `📊 ${parts.join(' | ')}  |  총 ${total}개`;
}

// ===== 10. control.html 전용 =====
let pendingAttachments = [];

function initControl() {
  const cfg = GitHub.loadCfg();
  if (!cfg || !cfg.token) {
    alert('GitHub 연동이 필요합니다. 메인 페이지에서 설정해 주세요.');
    return;
  }

  loadAllData(false).then(() => {
    renderControl();
  });

  // 이벤트 바인딩
  document.getElementById('deckSelect').addEventListener('change', function() {
    currentDeck = this.value;
    renderControl();
  });

  document.getElementById('saveCardBtn').addEventListener('click', saveNewCard);
  document.getElementById('clearFormBtn').addEventListener('click', clearForm);
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('addDeckBtn').addEventListener('click', addNewDeck);

  document.querySelectorAll('.control-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.control-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.control-page').forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${this.dataset.tab}`).classList.add('active');
      if (this.dataset.tab === 'search') doSearch();
    });
  });

  // 설정 모달 (app.js에서 이미 정의됨)
}

function renderControl() {
  // 덱 셀렉트
  const select = document.getElementById('deckSelect');
  const decks = [...new Set(cardsData.map(c => c.deck || '기타'))];
  if (!schemasData || Object.keys(schemasData).length === 0) {
    // 기본 스키마 제공
    schemasData = getDefaultSchemas();
  }
  const allDecks = [...new Set([...Object.keys(schemasData), ...decks])];
  select.innerHTML = allDecks.map(d =>
    `<option value="${d}" ${d === currentDeck ? 'selected' : ''}>${d}</option>`
  ).join('');

  // 새 카드 폼 렌더링
  renderNewCardForm();

  // 검색 결과 초기화 (포커스 유지)
  if (document.getElementById('tab-search').classList.contains('active')) {
    doSearch();
  }
}

function getDefaultSchemas() {
  return {
    "영어단어": {
      stages: [
        {
          stage: 1,
          label: "결합어구/예문",
          fields: [
            { key: "headword", label: "결합어구", type: "text", placeholder: "예: compensate for" },
            { key: "phonetic", label: "발음기호", type: "text", placeholder: "[KOM-puhn-seyt fawr]" },
            { key: "examples", label: "예문", type: "list-text", placeholder: "예문을 입력하세요" }
          ]
        },
        {
          stage: 2,
          label: "단어별 주석",
          fields: [
            {
              key: "entries",
              label: "단어 주석 목록",
              type: "list-entry",
              subfields: [
                { key: "word", label: "단어", type: "text" },
                { key: "difficulty", label: "난이도", type: "select", options: ["L0", "L1", "L2", "L3", "Lx"] },
                { key: "definition_en", label: "영문 뜻풀이", type: "textarea" },
                { key: "gloss_kr", label: "한글 힌트", type: "text", placeholder: "어근 힌트 (예: 보상)" }
              ]
            }
          ]
        }
      ]
    },
    "수학-수능기출": {
      stages: [
        { stage: 1, label: "문제", fields: [{ key: "problem_img", label: "문제 스냅샷", type: "image" }] },
        { stage: 2, label: "해독/전략", fields: [{ key: "analysis", label: "문제 해독", type: "textarea" }, { key: "strategy", label: "풀이 전략", type: "textarea" }] },
        { stage: 3, label: "풀이", fields: [{ key: "solution_img", label: "풀이 과정", type: "image" }] },
        { stage: 4, label: "정답/보충", fields: [{ key: "answer", label: "정답", type: "text" }, { key: "pattern_note", label: "패턴/보충", type: "textarea" }] }
      ]
    }
  };
}

function renderNewCardForm() {
  const container = document.getElementById('newCardForm');
  const schema = schemasData[currentDeck] || { stages: [{ stage: 1, label: "내용", fields: [{ key: "content", label: "내용", type: "textarea" }] }] };

  let html = '';
  for (const stage of schema.stages) {
    html += `<div class="form-section">
      <div class="form-section-title"><span class="stage-num">${stage.stage}</span> ${stage.label}</div>`;
    for (const field of stage.fields) {
      html += renderField(field);
    }
    html += `</div>`;
  }
  container.innerHTML = html;
}

function renderField(field) {
  const id = `field-${field.key}`;
  let html = `<div class="field-group">`;
  html += `<label for="${id}">${field.label}</label>`;

  if (field.type === 'text') {
    html += `<input id="${id}" type="text" placeholder="${field.placeholder || ''}">`;
  } else if (field.type === 'textarea') {
    html += `<textarea id="${id}" placeholder="${field.placeholder || ''}"></textarea>`;
  } else if (field.type === 'select') {
    html += `<select id="${id}">`;
    for (const opt of (field.options || [])) {
      html += `<option value="${opt}">${opt}</option>`;
    }
    html += `</select>`;
  } else if (field.type === 'image') {
    html += `<div class="attach-bar">
      <label class="attach-btn">📷 이미지 선택<input type="file" accept="image/*" onchange="handleImageUpload(this, '${field.key}')"></label>
      <div id="preview-${field.key}" class="preview-area"></div>
    </div>`;
  } else if (field.type === 'list-text') {
    html += `<div id="list-${field.key}">`;
    html += `<div class="list-text-items" id="list-items-${field.key}"></div>`;
    html += `<button class="add-btn" onclick="addListTextItem('${field.key}')">+ 항목 추가</button>`;
    html += `</div>`;
  } else if (field.type === 'list-entry') {
    html += `<div id="list-${field.key}">`;
    html += `<div class="list-entry-items" id="list-items-${field.key}"></div>`;
    html += `<button class="add-btn" onclick="addListEntryItem('${field.key}')">+ 항목 추가</button>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// list-text 항목 관리
let formData = {};

function addListTextItem(key) {
  const container = document.getElementById(`list-items-${key}`);
  if (!container) return;
  const id = `text-${key}-${Date.now()}`;
  const div = document.createElement('div');
  div.className = 'list-text-item';
  div.innerHTML = `
    <input type="text" id="${id}" placeholder="항목 입력">
    <button class="del-text-btn" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(div);
}

function addListEntryItem(key) {
  const container = document.getElementById(`list-items-${key}`);
  if (!container) return;
  // 스키마에서 subfields 추출
  const schema = schemasData[currentDeck] || {};
  let subfields = [];
  for (const stage of (schema.stages || [])) {
    for (const f of (stage.fields || [])) {
      if (f.key === key && f.subfields) {
        subfields = f.subfields;
        break;
      }
    }
  }
  const id = `entry-${key}-${Date.now()}`;
  const div = document.createElement('div');
  div.className = 'list-entry-item';
  div.id = id;
  let html = '';
  for (const sf of subfields) {
    const sfId = `${id}-${sf.key}`;
    if (sf.type === 'text') {
      html += `<div class="field-group" style="margin-bottom:4px"><label>${sf.label}</label><input id="${sfId}" type="text"></div>`;
    } else if (sf.type === 'textarea') {
      html += `<div class="field-group" style="margin-bottom:4px"><label>${sf.label}</label><textarea id="${sfId}"></textarea></div>`;
    } else if (sf.type === 'select') {
      html += `<div class="field-group" style="margin-bottom:4px"><label>${sf.label}</label><select id="${sfId}">`;
      for (const opt of (sf.options || [])) {
        html += `<option value="${opt}">${opt}</option>`;
      }
      html += `</select></div>`;
    }
  }
  div.innerHTML = html + `<button class="del-entry-btn" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(div);
}

function handleImageUpload(input, key) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById(`preview-${key}`);
  if (!preview) return;
  const url = URL.createObjectURL(file);
  preview.innerHTML = `
    <div class="preview-item">
      <img src="${url}" style="max-width:100%;max-height:120px;border-radius:4px;">
      <button onclick="this.parentElement.remove();document.getElementById('input-${key}').value=''" style="background:none;border:none;color:var(--accent-red);cursor:pointer;">✕</button>
    </div>
  `;
  // 파일 저장
  if (!formData[key]) formData[key] = {};
  formData[key].file = file;
  formData[key].preview = url;
}

// 새 카드 저장
async function saveNewCard() {
  const schema = schemasData[currentDeck] || { stages: [{ stage: 1, label: "내용", fields: [{ key: "content", label: "내용", type: "textarea" }] }] };
  const stages = [];
  let hasContent = false;

  for (const stage of schema.stages) {
    const fields = {};
    let stageHasContent = false;
    for (const f of stage.fields) {
      const el = document.getElementById(`field-${f.key}`);
      if (f.type === 'list-text') {
        const items = document.querySelectorAll(`#list-items-${f.key} input`);
        const values = [];
        for (const inp of items) {
          if (inp.value.trim()) values.push(inp.value.trim());
        }
        if (values.length) stageHasContent = true;
        fields[f.key] = values;
      } else if (f.type === 'list-entry') {
        const entries = document.querySelectorAll(`#list-items-${f.key} .list-entry-item`);
        const values = [];
        for (const entry of entries) {
          const obj = {};
          let entryHasContent = false;
          for (const sf of (f.subfields || [])) {
            const inp = entry.querySelector(`#${entry.id}-${sf.key}`);
            if (inp && inp.value.trim()) {
              obj[sf.key] = inp.value.trim();
              entryHasContent = true;
            }
          }
          if (entryHasContent) values.push(obj);
        }
        if (values.length) stageHasContent = true;
        fields[f.key] = values;
      } else if (f.type === 'image') {
        if (formData[f.key] && formData[f.key].file) {
          stageHasContent = true;
          fields[f.key] = { file: formData[f.key].file, filename: null };
        }
      } else {
        if (el && el.value.trim()) {
          stageHasContent = true;
          fields[f.key] = el.value.trim();
        }
      }
    }
    if (stageHasContent) hasContent = true;
    stages.push({ label: stage.label, fields });
  }

  if (!hasContent) {
    showToast('최소 하나의 필드를 채워주세요.', true);
    return;
  }

  // 이미지 업로드 처리
  const qc = buildQcode(new Date());
  const id = Date.now();
  for (const stage of stages) {
    for (const [key, value] of Object.entries(stage.fields)) {
      if (value && typeof value === 'object' && value.file) {
        try {
          const ext = 'jpg';
          const filename = `${qc}_${id}_${key}.${ext}`;
          await GitHub.uploadRaw(value.file, filename, true);
          stage.fields[key] = `raw/images/${filename}`;
        } catch (e) {
          showToast(`이미지 업로드 실패: ${e.message}`, true);
          return;
        }
      }
    }
  }

  const newCard = {
    id,
    deck: currentDeck,
    stages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  cardsData.unshift(newCard);
  scoresData[id] = { star: 0, x: 0 };

  SaveQueue.schedule(FILES.cards, cardsData, `add card ${id}`);
  SaveQueue.schedule(FILES.scores, scoresData, `add score ${id}`);

  clearForm();
  renderControl();
  showToast('💾 카드 저장 완료');
}

function clearForm() {
  document.querySelectorAll('#newCardForm input, #newCardForm textarea').forEach(el => {
    el.value = '';
  });
  document.querySelectorAll('.list-text-items, .list-entry-items').forEach(el => {
    el.innerHTML = '';
  });
  document.querySelectorAll('.preview-area').forEach(el => {
    el.innerHTML = '';
  });
  formData = {};
}

// 검색
function doSearch() {
  const keyword = document.getElementById('searchInput').value.trim().toLowerCase();
  const results = document.getElementById('searchResults');
  if (!keyword) {
    results.innerHTML = '<div class="empty-state">검색어를 입력하세요</div>';
    return;
  }

  const hits = cardsData.filter(c => {
    const searchText = JSON.stringify(c).toLowerCase();
    return searchText.includes(keyword);
  });

  if (!hits.length) {
    results.innerHTML = '<div class="empty-state">검색 결과가 없습니다</div>';
    return;
  }

  results.innerHTML = hits.map(c => {
    const title = getCardTitle(c);
    const deck = c.deck || '기타';
    const score = scoresData[c.id] || { star: 0, x: 0 };
    return `<div class="search-result-item" data-id="${c.id}">
      <div class="result-header">
        <span class="result-title">${escHtml(title)}</span>
        <span class="result-deck">${escHtml(deck)} ★${score.star || 0} ❌${score.x || 0}</span>
      </div>
      <div class="result-body" id="result-body-${c.id}">
        ${escHtml(JSON.stringify(c.stages).slice(0, 200))}...
      </div>
      <div class="result-actions">
        <button onclick="editCard('${c.id}')">✏️ 수정</button>
        <button class="del-btn" onclick="deleteCard('${c.id}')">🗑️ 삭제</button>
      </div>
      <div class="result-edit-area" id="edit-area-${c.id}" style="display:none;"></div>
    </div>`;
  }).join('');
}

function editCard(id) {
  const card = cardsData.find(c => c.id == id);
  if (!card) return;
  const area = document.getElementById(`edit-area-${id}`);
  if (!area) return;
  const body = document.getElementById(`result-body-${id}`);
  if (body) body.style.display = 'none';

  area.style.display = 'block';
  area.innerHTML = `
    <textarea id="edit-text-${id}">${escHtml(JSON.stringify(card, null, 2))}</textarea>
    <div class="edit-actions">
      <button class="edit-save-btn" onclick="commitEdit('${id}')">저장</button>
      <button class="edit-cancel-btn" onclick="cancelEdit('${id}')">취소</button>
    </div>
  `;
}

function cancelEdit(id) {
  const area = document.getElementById(`edit-area-${id}`);
  if (area) { area.style.display = 'none'; area.innerHTML = ''; }
  const body = document.getElementById(`result-body-${id}`);
  if (body) body.style.display = 'block';
}

async function commitEdit(id) {
  const ta = document.getElementById(`edit-text-${id}`);
  if (!ta) return;
  try {
    const updated = JSON.parse(ta.value);
    const idx = cardsData.findIndex(c => c.id == id);
    if (idx === -1) throw new Error('카드를 찾을 수 없습니다');
    cardsData[idx] = { ...cardsData[idx], ...updated, updatedAt: new Date().toISOString() };
    SaveQueue.schedule(FILES.cards, cardsData, `edit card ${id}`);
    cancelEdit(id);
    renderControl();
    showToast('✏️ 수정 완료');
  } catch (e) {
    showToast(`JSON 오류: ${e.message}`, true);
  }
}

function deleteCard(id) {
  const card = cardsData.find(c => c.id == id);
  if (!card) return;
  showConfirm(`"${getCardTitle(card)}" 카드를 삭제하시겠습니까?`, () => {
    cardsData = cardsData.filter(c => c.id != id);
    delete scoresData[id];
    SaveQueue.schedule(FILES.cards, cardsData, `delete ${id}`);
    SaveQueue.schedule(FILES.scores, scoresData, `remove score ${id}`);
    renderControl();
    showToast('🗑️ 삭제 완료');
  });
}

function addNewDeck() {
  const name = prompt('새 덱 이름을 입력하세요:');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (schemasData[trimmed]) {
    showToast('이미 존재하는 덱입니다.', true);
    return;
  }
  // 기본 스키마 생성 (1단계, text 필드 1개)
  schemasData[trimmed] = {
    stages: [
      { stage: 1, label: "내용", fields: [{ key: "content", label: "내용", type: "textarea" }] }
    ]
  };
  SaveQueue.schedule(FILES.schemas, schemasData, `add deck ${trimmed}`);
  currentDeck = trimmed;
  renderControl();
  showToast(`✅ 덱 "${trimmed}" 추가됨`);
}

// ===== 11. 페이지별 초기화 (외부에서 호출) =====
// app.js 로드 후 index.html/control.html에서 각각 호출
console.log('📚 memo_crd app.js 로드됨');