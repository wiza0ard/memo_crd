/* gh-api.js — memo_crd 공용 GitHub Contents API 모듈 */

const GH_REPO_NAME = 'memo_crd';
const GH_BRANCH = 'main';
const RAW_DIR = 'raw';

function getToken(){ return localStorage.getItem('mc_token') || ''; }
function getOwner(){ return localStorage.getItem('mc_owner') || ''; }
function setAuth(owner, token){
  localStorage.setItem('mc_owner', owner);
  localStorage.setItem('mc_token', token);
}
function clearAuth(){
  localStorage.removeItem('mc_owner');
  localStorage.removeItem('mc_token');
}
function hasAuth(){ return !!(getToken() && getOwner()); }

function authHeaders(extra={}){
  return Object.assign({
    Authorization: `Bearer ${getToken()}`,
    Accept: 'application/vnd.github+json'
  }, extra);
}

function contentsUrl(path){
  return `https://api.github.com/repos/${getOwner()}/${GH_REPO_NAME}/contents/${path}`;
}

function b64encode(str){
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b64){
  return decodeURIComponent(escape(atob(b64.replace(/\n/g,''))));
}

// 토큰 + 저장소 접근 검증
async function verifyAccess(owner, token){
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (!userRes.ok) throw new Error('토큰이 유효하지 않습니다.');
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${GH_REPO_NAME}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (!repoRes.ok) throw new Error(`저장소 ${owner}/${GH_REPO_NAME} 에 접근할 수 없습니다.`);
  return true;
}

// JSON 파일 읽기 → { data, sha } 반환. 파일이 없으면 { data:null, sha:null }
async function ghGetJson(path){
  const res = await fetch(contentsUrl(path) + `?ref=${GH_BRANCH}&t=${Date.now()}`, { headers: authHeaders() });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`${path} 읽기 실패 (${res.status})`);
  const json = await res.json();
  const text = b64decode(json.content);
  return { data: JSON.parse(text), sha: json.sha };
}

// JSON 파일 쓰기 (있으면 sha로 업데이트, 없으면 새로 생성)
async function ghPutJson(path, dataObj, message){
  let sha = null;
  try {
    const res = await fetch(contentsUrl(path) + `?ref=${GH_BRANCH}`, { headers: authHeaders() });
    if (res.ok) { const j = await res.json(); sha = j.sha; }
  } catch(e){ /* 파일 없으면 무시 */ }

  const body = {
    message: message || `update ${path}`,
    content: b64encode(JSON.stringify(dataObj, null, 2)),
    branch: GH_BRANCH
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(contentsUrl(path), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (!putRes.ok) {
    const err = await putRes.json().catch(()=>({}));
    throw new Error(`${path} 저장 실패: ${err.message || putRes.status}`);
  }
  return true;
}

// raw/ 폴더에 바이너리 파일 업로드. file: File 객체. 반환: 저장된 상대경로
async function uploadRawFile(file, subdir, filename){
  const path = `${RAW_DIR}/${subdir}/${filename}`;
  const dataUrl = await new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const base64 = dataUrl.split(',')[1];

  let sha = null;
  try {
    const res = await fetch(contentsUrl(path) + `?ref=${GH_BRANCH}`, { headers: authHeaders() });
    if (res.ok) { const j = await res.json(); sha = j.sha; }
  } catch(e){}

  const body = { message: `upload ${filename}`, content: base64, branch: GH_BRANCH };
  if (sha) body.sha = sha;

  const putRes = await fetch(contentsUrl(path), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (!putRes.ok) {
    const err = await putRes.json().catch(()=>({}));
    throw new Error(`파일 업로드 실패: ${err.message || putRes.status}`);
  }
  return path;
}

function rawFileSubdir(type){
  if (type === 'image') return 'images';
  if (type === 'audio') return 'audio';
  if (type === 'pdf') return 'pdf';
  return 'misc';
}

function fileExt(name){
  const m = /\.([a-zA-Z0-9]+)$/.exec(name||'');
  return m ? m[1].toLowerCase() : 'bin';
}

function safeFilename(prefix, ext){
  return `${prefix}_${Date.now()}.${ext}`;
}
