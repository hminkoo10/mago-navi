import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, call, designApi, type DesignApi, type Me, postJson } from './api'
import { useAcademyRoster, type AcademyRoster } from './academy-roster'

// 학원 학생 명단 (통합 클라우드). 학원에 속한 사람은 학생을 골라 그 학생의 설계를 연다.
// 명단은 서버가 클라우드에서 대신 받아 준다. 학원 사람 누구나 추가·되살리기를 할 수 있고,
// 지운 학생은 목록에서 숨긴다 (30일 안에 되살리지 않으면 클라우드가 완전히 지움).

export interface Student {
  id: string
  name: string
  school: string
  grade: string
  /** 담당 선생님 */
  teacher: { id: string; name: string } | null
  memo: string
  rev: number
  /** 지운 때. 지우지 않았으면 null */
  deletedAt: number | string | null
}

export const studentsApi = {
  list: () => call<{ students: Student[]; purged: string[]; purgeDays: number }>('/api/students'),
  add: (b: { name: string; school: string; grade: string; teacherId?: string }) => call<{ student: Student }>('/api/students', postJson(b)),
  restore: (id: string) => call<{ student: Student }>(`/api/students/${encodeURIComponent(id)}/restore`, postJson({})),
}

/** 그 학생 설계를 받고 올리는 곳 */
export const studentData = (id: string): DesignApi => designApi(`/api/students/${encodeURIComponent(id)}/data`)

/** 이 기기에서 마지막으로 연 학생 (계정마다) */
const lastKey = (userId: number) => `mago-navi:student@${userId}`

function readLast(userId: number): string | null {
  try {
    return localStorage.getItem(lastKey(userId))
  } catch {
    return null
  }
}

function writeLast(userId: number, id: string | null): void {
  try {
    if (id) localStorage.setItem(lastKey(userId), id)
    else localStorage.removeItem(lastKey(userId))
  } catch {
    // 저장소를 못 쓰면 다음에 다시 고른다
  }
}

/** 이름·학교·학년으로 찾기 */
export const matchStudent = (s: Student, q: string) => {
  const t = q.trim().toLowerCase()
  return !t || [s.name, s.school, s.grade].some((x) => (x ?? '').toLowerCase().includes(t))
}

export interface Students {
  /** PC에서만 전달되는 읽기 전용 학원 명단. 웹/학원 밖 계정은 null */
  roster: AcademyRoster | null
  /** 학원 사람인지. 아니면 명단 없이 내 계정에 설계 하나 */
  active: boolean
  /** 명단 (지운 학생 포함). 받기 전이면 null */
  list: Student[] | null
  /** 명단을 받지 못한 까닭 */
  error: string
  /** 지금 설계를 연 학생 */
  current: Student | null
  /** 지운 학생을 되살릴 수 있는 날 수 (클라우드 설정) */
  purgeDays: number
  /** 이 학생 설계를 연다 (null이면 닫음) */
  pick: (id: string | null) => void
  reload: () => Promise<void>
  /** 학생을 추가하고 그 학생 설계를 연다. 담당은 나 */
  add: (b: { name: string; school: string; grade: string }) => Promise<Student>
  restore: (id: string) => Promise<void>
}

/**
 * 학원 사람의 학생 명단과 지금 연 학생. 처음 받을 때 이 기기에서 마지막으로 연 학생을 다시 연다 (지운 학생이면 열지 않음).
 * 연 학생을 그사이 누가 지우면 열어 둔 채 보기만 하게 하고 (App), 완전히 지워졌으면 닫는다
 */
export function useStudents(user: Me | null): Students {
  const roster = useAcademyRoster(user)
  const studentRole = user?.magoRole === 'student'
  const who = user && (user.academy || studentRole) ? user.id : null
  const cloudId = user?.cloudId ?? ''
  const self = useMemo<Student | null>(() => {
    const s = studentRole ? user?.student : null
    return s ? {
      id: s.id, name: s.name, school: '', grade: '', memo: '', rev: 0, deletedAt: null,
      teacher: s.teacherUid ? { id: s.teacherUid, name: s.teacherName } : null,
    } : null
  }, [studentRole, user?.student])
  const [list, setList] = useState<Student[] | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [purgeDays, setPurgeDays] = useState(30)
  // 계정이 바뀌면 처음부터
  const identity = who === null ? '' : `${who}:${studentRole ? self?.id ?? 'student' : 'staff'}`
  const [owner, setOwner] = useState(identity)
  if (owner !== identity) {
    setOwner(identity)
    setList(null)
    setError('')
    setPicked(null)
  }

  /** 이 계정 명단을 받은 적이 있는지 (처음이면 마지막으로 연 학생을 다시 연다) */
  const loadedFor = useRef<number | null>(null)
  const seq = useRef(0)
  const reload = useCallback((): Promise<void> => {
    if (who === null) return Promise.resolve()
    const n = ++seq.current
    return studentsApi.list().then(
      (r) => {
        if (n !== seq.current) return
        const first = loadedFor.current !== who
        loadedFor.current = who
        setList(r.students)
        setPurgeDays(r.purgeDays || 30)
        setError('')
        setPicked((p) => {
          if (studentRole) return r.students[0]?.id ?? null
          const id = first ? readLast(who) : p
          const s = id ? r.students.find((x) => x.id === id) : undefined
          return s && !(first && s.deletedAt) ? s.id : null
        })
      },
      (e: unknown) => {
        if (n !== seq.current) return
        setError(e instanceof ApiError ? e.message : '학생 명단을 받지 못했어요.')
      },
    )
  }, [who, studentRole])

  useEffect(() => {
    void reload()
  }, [reload])
  // 다른 곳(통합 클라우드·다른 선생님)에서 고쳤을 수 있어 탭으로 돌아오면 다시 받는다
  useEffect(() => {
    if (who === null) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [who, reload])

  const pick = useCallback(
    (id: string | null) => {
      if (who === null || studentRole) return
      setPicked(id)
      writeLast(who, id)
    },
    [who, studentRole],
  )

  const add = useCallback(
    async (b: { name: string; school: string; grade: string }) => {
      if (studentRole) throw new Error('학생 계정으로는 명단을 고칠 수 없어요.')
      const { student } = await studentsApi.add({ ...b, ...(cloudId ? { teacherId: cloudId } : {}) })
      await reload()
      pick(student.id)
      return student
    },
    [cloudId, reload, pick, studentRole],
  )

  const restore = useCallback(
    async (id: string) => {
      if (studentRole) throw new Error('학생 계정으로는 명단을 고칠 수 없어요.')
      await studentsApi.restore(id)
      await reload()
    },
    [reload, studentRole],
  )

  const existing = studentRole ? (list?.find((s) => s.id === self?.id) ?? self) : (picked && list?.find((s) => s.id === picked)) || null
  const native = roster?.students.find((s) => s.id === (studentRole ? self?.id : picked))
  const current = useMemo(() => native && !existing?.deletedAt
    ? { teacher: null, memo: '', rev: 0, deletedAt: null, ...existing, ...native }
    : existing, [native, existing])
  return useMemo(
    () => ({ active: who !== null, roster, list, error, current, purgeDays, pick, reload, add, restore }),
    [who, roster, list, error, current, purgeDays, pick, reload, add, restore],
  )
}
