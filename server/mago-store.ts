import type { DatabaseSync } from 'node:sqlite'
import { hashOf, type User } from './accounts'
import { openKey, sealKey } from './ai-providers'

// 이 서버에 두는 통합 클라우드 계정 정보(학원·역할·AI 고르기)와, 로그인 세션에 묶인 클라우드 세션 (mago-auth.ts가 씀)

/** AI 기능에 쓸 것: academy 학원 AI(기본), own 내 Gemini API 키 */
export type AiSource = 'academy' | 'own'

export interface MagoProfile {
  /** 통합 클라우드 계정 ID. 예전 계정이면 빈 값 */
  cloudId: string
  academyId: number | null
  academyName: string
  /** 통합 클라우드 역할 (admin·director·teacher) */
  magoRole: string
  aiSource: AiSource
}

/** 이만큼 지나면 클라우드에 다시 확인 (이름·역할·학원, 클라우드 세션이 살아 있는지) */
export const REFRESH_MS = 10 * 60_000

export class MagoStore {
  private db: DatabaseSync
  private secret: Buffer
  /** 세션마다 다시 확인은 한 번에 하나만 (동시에 온 요청이 클라우드를 여러 번 부르지 않게) */
  readonly refreshing = new Map<string, Promise<User | null>>()

  /** users·sessions 표는 Accounts가 만든 뒤에 연다 */
  constructor(db: DatabaseSync, secret: Buffer) {
    this.db = db
    this.secret = secret
    const cols = (table: string) => new Set((db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name))
    const users = cols('users')
    if (!users.has('academy_id')) db.exec('alter table users add column academy_id integer')
    if (!users.has('academy_name')) db.exec("alter table users add column academy_name text not null default ''")
    if (!users.has('mago_role')) db.exec("alter table users add column mago_role text not null default ''")
    if (!users.has('ai_source')) db.exec("alter table users add column ai_source text not null default 'academy'")
    // 클라우드 세션 토큰은 사용자 Gemini 키와 같은 비밀값(AI_KEY_SECRET)으로 암호화해 둔다
    const sessions = cols('sessions')
    if (!sessions.has('cloud_token')) db.exec('alter table sessions add column cloud_token text')
    if (!sessions.has('cloud_checked_at')) db.exec('alter table sessions add column cloud_checked_at text')
  }

  profile(userId: number): MagoProfile | null {
    const r = this.db.prepare('select google_sub, academy_id, academy_name, mago_role, ai_source from users where id = ?').get(userId) as
      { google_sub: string; academy_id: number | null; academy_name: string; mago_role: string; ai_source: string } | undefined
    if (!r) return null
    return {
      cloudId: r.google_sub.startsWith('mago:') ? r.google_sub.slice(5) : '',
      academyId: r.academy_id ?? null,
      academyName: r.academy_name,
      magoRole: r.mago_role,
      aiSource: r.ai_source === 'own' ? 'own' : 'academy',
    }
  }

  setProfile(userId: number, p: { academyId: number | null; academyName: string; magoRole: string }): void {
    this.db.prepare('update users set academy_id = ?, academy_name = ?, mago_role = ? where id = ?').run(p.academyId, p.academyName, p.magoRole, userId)
  }

  setAiSource(userId: number, source: AiSource): void {
    this.db.prepare('update users set ai_source = ? where id = ?').run(source, userId)
  }

  /** 로그인 세션에 클라우드 세션 토큰을 암호화해 묶는다 */
  attach(session: string, cloudToken: string, now = new Date()): void {
    this.db.prepare('update sessions set cloud_token = ?, cloud_checked_at = ? where id = ?').run(sealKey(this.secret, cloudToken), now.toISOString(), hashOf(session))
  }

  /** 묶인 클라우드 세션 토큰. 없으면 undefined, 서버 비밀값이 바뀌어 못 풀면 null */
  cloudToken(session: string): string | null | undefined {
    const r = this.db.prepare('select cloud_token from sessions where id = ?').get(hashOf(session)) as { cloud_token: string | null } | undefined
    return r?.cloud_token ? openKey(this.secret, r.cloud_token) : undefined
  }

  /** 클라우드에 다시 확인할 때가 됐는지. 클라우드 세션이 묶인 세션만 */
  due(session: string, now = new Date()): boolean {
    const r = this.db.prepare('select cloud_token, cloud_checked_at from sessions where id = ?').get(hashOf(session)) as
      { cloud_token: string | null; cloud_checked_at: string | null } | undefined
    if (!r?.cloud_token) return false
    return !r.cloud_checked_at || now.getTime() - Date.parse(r.cloud_checked_at) >= REFRESH_MS
  }

  /** 다시 확인한 때. at 없이 부르면 다음 요청에서 바로 다시 확인 */
  checked(session: string, at: Date | null = new Date()): void {
    this.db.prepare('update sessions set cloud_checked_at = ? where id = ?').run(at ? at.toISOString() : null, hashOf(session))
  }

  /** 통합 클라우드 계정이 아닌 계정(예전 Google 계정)의 세션을 모두 끊는다. 끊은 세션 수 */
  revokeLegacy(): number {
    return Number(this.db.prepare("delete from sessions where user_id in (select id from users where substr(google_sub, 1, 5) != 'mago:')").run().changes)
  }
}
