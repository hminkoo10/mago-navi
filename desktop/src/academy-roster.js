'use strict';

// SDK는 그대로 둔다. 오답노트처럼 폴더 감시 + 주기 확인, renderer에는 필요한 명단만 전달.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_STUDENTS = 5000;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.length <= max && ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const id = (v) => text(v, 80) && /^[A-Za-z0-9_-]+$/.test(v);

function parseRoster(raw, user) {
  if (!object(raw) || raw.format !== 1 || !object(raw.academy) || !object(raw.me)) return null;
  const { academy, me } = raw;
  if (!Number.isSafeInteger(academy.id) || academy.id <= 0 || !text(academy.name, 200) || !academy.name.trim()) return null;
  if (!id(me.id) || me.id !== user?.id || me.role !== user?.role || !text(me.name, 100)) return null;
  if (!['admin', 'director', 'teacher', 'student'].includes(me.role)) return null;
  if (!Number.isSafeInteger(raw.updatedAt) || raw.updatedAt < 0) return null;
  if (!Array.isArray(raw.students) || raw.students.length > MAX_STUDENTS) return null;
  if (raw.purged !== undefined && (!Array.isArray(raw.purged) || raw.purged.length > MAX_STUDENTS || !raw.purged.every(id))) return null;
  const purged = new Set(raw.purged || []);
  const counts = new Map();
  for (const s of raw.students) if (object(s) && id(s.id)) counts.set(s.id, (counts.get(s.id) || 0) + 1);
  const students = [];
  for (const s of raw.students) {
    if (!object(s) || !id(s.id) || counts.get(s.id) !== 1 || purged.has(s.id)) continue;
    if (s.deletedAt != null || s.purgedAt != null) continue;
    if (!text(s.name, 100) || !s.name.trim()) continue;
    if (s.school !== undefined && !text(s.school, 200)) continue;
    if (s.grade !== undefined && !text(s.grade, 30)) continue;
    students.push({ id: s.id, name: s.name.trim(), school: (s.school || '').trim(), grade: (s.grade || '').trim() });
  }
  // memo·members·AI 설정/키·계정 정보·로컬 경로는 노출하지 않는다.
  return { academy: { id: academy.id, name: academy.name }, me: { id: me.id, name: me.name, role: me.role }, students };
}

function rosterFile(session) {
  if (!session?.user?.academy || !session.academyInfoFile || !session.dataDir) return null;
  if (!path.isAbsolute(session.academyInfoFile) || !path.isAbsolute(session.dataDir)) return null;
  const file = path.resolve(session.academyInfoFile);
  // academyInfo는 sync 폴더 안이 아니라 계정별 앱 폴더 바로 아래에 있다.
  return file === path.resolve(session.dataDir, '..', 'academy-info.json') ? file : null;
}

function readRoster(session) {
  const file = rosterFile(session);
  if (!file) return null;
  let fd;
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    // stat 이후 파일이 커져도 상한 이상 읽거나 할당하지 않는다.
    const bytes = Buffer.alloc(stat.size + 1);
    let n = 0;
    let read;
    while (n < bytes.length && (read = fs.readSync(fd, bytes, n, bytes.length - n, null)) > 0) n += read;
    if (n > stat.size) return null;
    return parseRoster(JSON.parse(bytes.subarray(0, n).toString('utf8')), session.user);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function watchRoster(session, cb, { delayMs = 200, pollMs = 30000 } = {}) {
  const file = rosterFile(session);
  if (!file) return () => {};
  let timer;
  let watcher;
  let last = JSON.stringify(readRoster(session));
  const fire = () => {
    const roster = readRoster(session);
    const next = JSON.stringify(roster);
    if (next === last) return;
    last = next;
    cb(roster); // 삭제·잘못된 파일도 null로 알려 오래된 명단을 비운다.
  };
  try {
    // launcher가 원자적으로 파일을 교체한다. 파일 대신 폴더를 감시하며 폴더를 만들지는 않는다.
    watcher = fs.watch(path.dirname(file), (_event, name) => {
      if (name && String(name) !== path.basename(file)) return;
      clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    });
    watcher.on('error', () => {});
  } catch { /* 감시 실패 시 주기 확인 */ }
  const poll = setInterval(fire, pollMs);
  poll.unref?.();
  return () => { clearTimeout(timer); clearInterval(poll); watcher?.close(); };
}

/** IPC는 허용된 사이트의 주 창/주 프레임에만. 로컬 안내·iframe·다른 창은 명단을 받지 못한다. */
function rosterSender(event, win, origin) {
  try {
    return !!win && !win.isDestroyed() && event.sender === win.webContents &&
      event.senderFrame === win.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin;
  } catch { return false; }
}

module.exports = { MAX_BYTES, MAX_STUDENTS, parseRoster, rosterFile, readRoster, watchRoster, rosterSender };
