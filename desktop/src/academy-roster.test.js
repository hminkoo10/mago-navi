import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { MAX_BYTES, MAX_STUDENTS, parseRoster, rosterFile, readRoster, watchRoster, rosterSender } = require('./academy-roster.js');
const user = { id: 'teacher-1', name: '선생님', role: 'teacher', academy: '마고학원' };
const student = { id: 'student-1', name: '홍학생', school: '반송고', grade: '고1' };
const fixture = (extra = {}) => ({ format: 1, academy: { id: 7, name: '마고학원' }, me: user, students: [student], purged: [], updatedAt: 1, ...extra });

describe('학원 명단 검증', () => {
  it('필요한 필드만 반환하며 미래 필드는 허용한다', () => {
    const raw = fixture({ members: [{ secret: 'x' }], ai: { apiKey: 'secret' }, future: true,
      students: [{ ...student, memo: '개인 메모', teacher_uid: 'teacher-1', future: true }] });
    expect(parseRoster(raw, user)).toEqual({ academy: { id: 7, name: '마고학원' },
      me: { id: user.id, name: user.name, role: user.role }, students: [student] });
    expect(raw.ai.apiKey).toBe('secret'); // 원본 파일/객체는 수정하지 않음
  });
  it.each([null, [], 'json', fixture({ format: 2 }), fixture({ academy: [] }), fixture({ updatedAt: '1' }),
    fixture({ students: {} }), fixture({ students: Array(MAX_STUDENTS + 1).fill(student) }),
    fixture({ purged: ['../x'] }), fixture({ me: { ...user, id: 'other' } }), fixture({ me: { ...user, role: 'student' } }),
  ])('잘못된 헤더/계정/상한은 명단 전체를 거절한다: %#', (raw) => expect(parseRoster(raw, user)).toBeNull());
  it('삭제·영구삭제·중복 ID·잘못된 행은 제외한다', () => {
    const rows = [student, null, [], { ...student, id: 'deleted-1', deletedAt: 1 },
      { ...student, id: 'purged-1' }, { ...student, id: 'duplicate' }, { ...student, id: 'duplicate' },
      { ...student, id: '../path' }, { ...student, id: 'empty', name: ' ' },
      { ...student, id: 'long', school: '가'.repeat(201) }, { ...student, id: 'object', grade: {} },
      { ...student, id: 'control', name: '가\u0000나' }];
    expect(parseRoster(fixture({ students: rows, purged: ['purged-1'] }), user).students).toEqual([student]);
  });
  it('학교/학년이 없는 학생은 이름만 유지한다', () => {
    expect(parseRoster(fixture({ students: [{ id: 'student-2', name: '김학생' }] }), user).students[0])
      .toEqual({ id: 'student-2', name: '김학생', school: '', grade: '' });
  });
});

const dirs = [];
const stops = [];
function session() {
  // 설치 앱/사용자 데이터/temp 밖: 이 worktree 안에서 만든 시험 폴더만 사용한다.
  const dir = fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.roster-test-'));
  dirs.push(dir);
  return { user, dataDir: path.join(dir, 'sync'), academyInfoFile: path.join(dir, 'academy-info.json') };
}
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('명단 읽기/감시', () => {
  it('학원/경로가 없거나 다른 파일이면 읽지 않는다', () => {
    const cs = session();
    expect(rosterFile({ ...cs, user: { ...user, academy: '' } })).toBeNull();
    expect(rosterFile({ ...cs, academyInfoFile: path.join(cs.dataDir, 'else.json') })).toBeNull();
    expect(rosterFile({ ...cs, academyInfoFile: 'academy-info.json' })).toBeNull();
    expect(readRoster(null)).toBeNull();
    expect(readRoster(cs)).toBeNull();
  });
  it('정상 파일만 읽고 잘못된 JSON/큰 파일은 거절한다', () => {
    const cs = session();
    fs.writeFileSync(cs.academyInfoFile, JSON.stringify(fixture()));
    expect(readRoster(cs)?.students).toEqual([student]);
    fs.writeFileSync(cs.academyInfoFile, '{');
    expect(readRoster(cs)).toBeNull();
    fs.writeFileSync(cs.academyInfoFile, Buffer.alloc(MAX_BYTES + 1));
    expect(readRoster(cs)).toBeNull();
  });
  it('원자 교체·같은 updatedAt 변경·삭제·재생성을 받고 종료 후에는 알리지 않는다', async () => {
    const cs = session();
    fs.writeFileSync(cs.academyInfoFile, JSON.stringify(fixture()));
    const cb = vi.fn();
    const stop = watchRoster(cs, cb, { delayMs: 5, pollMs: 20 });
    stops.push(stop);
    fs.writeFileSync(`${cs.academyInfoFile}.tmp`, JSON.stringify(fixture({ students: [{ ...student, grade: '고2' }] })));
    fs.renameSync(`${cs.academyInfoFile}.tmp`, cs.academyInfoFile);
    await vi.waitFor(() => expect(cb.mock.lastCall?.[0]?.students[0].grade).toBe('고2'));
    fs.unlinkSync(cs.academyInfoFile);
    await vi.waitFor(() => expect(cb.mock.lastCall?.[0]).toBeNull());
    fs.writeFileSync(cs.academyInfoFile, JSON.stringify(fixture()));
    await vi.waitFor(() => expect(cb.mock.lastCall?.[0]?.students[0].grade).toBe('고1'));
    stop();
    cb.mockClear();
    fs.writeFileSync(cs.academyInfoFile, '{');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cb).not.toHaveBeenCalled();
  });
  it('폴더 감시가 불가능해도 나중에 생긴 파일을 주기 확인한다', async () => {
    const cs = session();
    const parent = path.join(path.dirname(cs.dataDir), 'later');
    cs.dataDir = path.join(parent, 'sync');
    cs.academyInfoFile = path.join(parent, 'academy-info.json');
    const cb = vi.fn();
    stops.push(watchRoster(cs, cb, { pollMs: 20 }));
    expect(fs.existsSync(parent)).toBe(false);
    fs.mkdirSync(parent);
    fs.writeFileSync(cs.academyInfoFile, JSON.stringify(fixture()));
    await vi.waitFor(() => expect(cb.mock.lastCall?.[0]?.students).toEqual([student]));
  });
});

it('IPC는 허용 origin의 주 창/주 프레임만 받는다', () => {
  const frame = { url: 'http://localhost:5173/start' };
  const wc = { mainFrame: frame };
  const win = { isDestroyed: () => false, webContents: wc };
  const event = { sender: wc, senderFrame: frame };
  expect(rosterSender(event, win, 'http://localhost:5173')).toBe(true);
  expect(rosterSender({ ...event, senderFrame: { ...frame } }, win, 'http://localhost:5173')).toBe(false);
  expect(rosterSender({ ...event, sender: {} }, win, 'http://localhost:5173')).toBe(false);
  frame.url = 'file:///offline.html';
  expect(rosterSender(event, win, 'http://localhost:5173')).toBe(false);
  frame.url = 'http://localhost:9999/start';
  expect(rosterSender(event, win, 'http://localhost:5173')).toBe(false);
});
