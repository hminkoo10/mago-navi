import type { DatabaseSync } from 'node:sqlite'
import type { SavedData } from './accounts'

// 학원 학생별 설계. 학생 명단은 통합 클라우드에 있고(students-api.ts), 설계는 이 서버에 학원·학생마다 하나씩 둔다.
// 학원 사람 누구나 읽고 고친다 (담당 선생님이 바뀌어도 이어서). 클라우드에서 완전히 지운 학생은 명단을 받을 때 지운다.

export class StudentData {
  private db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
    db.exec(`create table if not exists student_data (
      academy_id integer not null,
      student_id text not null,
      data text not null,
      updated_at text not null,
      updated_by integer not null,
      primary key (academy_id, student_id)
    )`)
  }

  get(academyId: number, studentId: string): SavedData | null {
    const r = this.db.prepare('select data, updated_at from student_data where academy_id = ? and student_id = ?').get(academyId, studentId) as
      { data: string; updated_at: string } | undefined
    return r ? { data: JSON.parse(r.data), updatedAt: r.updated_at } : null
  }

  /** 저장된 설계 원문. 바뀌었는지 견줄 때 */
  text(academyId: number, studentId: string): string | null {
    const r = this.db.prepare('select data from student_data where academy_id = ? and student_id = ?').get(academyId, studentId) as { data: string } | undefined
    return r?.data ?? null
  }

  /** 저장된 설계의 저장 시각(판), 없으면 null */
  version(academyId: number, studentId: string): string | null {
    const r = this.db.prepare('select updated_at from student_data where academy_id = ? and student_id = ?').get(academyId, studentId) as
      { updated_at: string } | undefined
    return r?.updated_at ?? null
  }

  /** 저장 시각을 돌려준다. 그사이 고친 사람의 계정이 지워졌으면 저장하지 않고 null */
  put(academyId: number, studentId: string, userId: number, data: string): string | null {
    let at = new Date().toISOString()
    // 같은 밀리초에 두 번 저장해도 판이 겹치지 않게
    const prev = this.version(academyId, studentId)
    if (prev && prev >= at) at = new Date(Date.parse(prev) + 1).toISOString()
    const res = this.db
      .prepare(
        'insert into student_data (academy_id, student_id, data, updated_at, updated_by) select ?, ?, ?, ?, ? where exists (select 1 from users where id = ?) on conflict(academy_id, student_id) do update set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      )
      .run(academyId, studentId, data, at, userId, userId)
    return Number(res.changes) > 0 ? at : null
  }

  /** 클라우드에서 완전히 지운 학생의 설계를 지운다. 지운 수 */
  purge(academyId: number, studentIds: string[]): number {
    let n = 0
    const del = this.db.prepare('delete from student_data where academy_id = ? and student_id = ?')
    for (const id of studentIds) n += Number(del.run(academyId, id).changes)
    return n
  }
}
