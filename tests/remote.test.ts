import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { parseEntry, renderEntry } from '../hooks/register'
import { fixtureJson, fixtureMd } from './fixtures/journal-entry'

const MIN = 60 * 1000
const START = Date.UTC(2026, 0, 5, 8, 0)
const ENTRY = JSON.stringify({
  titel: 'Remote-Block', sphaere: 'arbeit', projekt: 'demo', kontext: 'Ein Test.',
  punkte: ['Erster Punkt'], erkenntnis: '', offen: '',
})

type Req = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }

function engine(on: On, responses: Array<{ status: number; text: string } | 'error'>) {
  const files = new Map<string, string>()
  const requests: Req[] = []
  const logs: string[] = []
  on('command.register', () => ({ value: { command: 'journal' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => e as never)
  on('session.id', () => ({ value: 'session-0000-test' }))
  on('session.cwd', () => ({ value: '/home/user/project' }))
  on('session.usage', () => ({ value: { startedAt: START } }) as never)
  on('session.redact', (_, e) => ({ value: (e as { text: string }).text }))
  on('model.fork', () => ({ value: { isAnswered: true, text: ENTRY, usage: {} } }) as never)
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.read', (_, e) => ({ value: files.get((e as { path: string }).path) ?? '' }) as never)
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined } as never
  })
  on('http.fetch', (_, e) => {
    const r = e as unknown as Req & { url: string }
    requests.push({ url: r.url, init: (r as never as { init: Req['init'] }).init ?? (r as never) })
    const next = responses.shift() ?? { status: 500, text: '{}' }
    if (next === 'error') throw new Error('network down')
    return { value: { status: next.status, ok: next.status < 300, headers: {}, text: next.text } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.log', (_, e) => {
    logs.push(String((e as { text?: string; message?: string }).text ?? (e as { message?: string }).message ?? ''))
    return { value: undefined } as never
  })
  return { files, requests, logs }
}

// Prompt at 09:00 Berlin, /journal 20 minutes later.
const run = async ($: Parameters<TestBody>[0], clock: { advance: (ms: number) => Promise<void> }) => {
  await $.session.start({ cwd: '/home/user/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hallo' } as never)
  await clock.advance(20 * MIN)
  return $.command.run({ command: 'journal', args: '' } as never)
}

test('remote: /journal schickt POST mit Bearer und source code-web', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/user', CLAUDE_CODE_REMOTE: 'true', SESSION_JOURNAL_TOKEN: 'vct_test' })
  const world = engine(on, [{ status: 201, text: JSON.stringify({ written: true, path: '_System/journal/arbeit/2026-01-05.md' }) }])
  const out = await run($, clock)
  expect(world.requests.length).toBe(1)
  const req = world.requests[0]!
  expect(req.url).toBe('https://vault.rubeen.dev/journal')
  expect(req.init.method).toBe('POST')
  expect(req.init.headers?.authorization).toBe('Bearer vct_test')
  const body = JSON.parse(req.init.body ?? '{}')
  expect(body.source).toBe('code-web')
  expect(body.session).toBe('session-0000-test')
  expect(body.kind).toBe('manual')
  expect(body.titel).toBe('Remote-Block')
  expect(body.from).toBe('2026-01-05T08:00:00.000Z')
  expect(body.to).toBe('2026-01-05T08:20:00.000Z')
  expect(world.files.size).toBe(0)
  expect(JSON.stringify(out)).toContain('_System/journal/arbeit/2026-01-05.md')
})

test('remote: ohne Token kein Request, Grund im Ergebnis', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/user', CLAUDE_CODE_REMOTE: 'true' })
  const world = engine(on, [])
  const out = await run($, clock)
  expect(world.requests.length).toBe(0)
  expect(world.files.size).toBe(0)
  expect(JSON.stringify(out)).toContain('kein SESSION_JOURNAL_TOKEN')
})

test('remote: Netzfehler → ein zweiter Versuch', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/user', CLAUDE_CODE_REMOTE: 'true', SESSION_JOURNAL_TOKEN: 'vct_test' })
  const world = engine(on, ['error', { status: 201, text: JSON.stringify({ written: true, path: 'p.md' }) }])
  const out = await run($, clock)
  expect(world.requests.length).toBe(2)
  expect(JSON.stringify(out)).toContain('p.md')
})

test('remote: 400 wird nicht wiederholt, Grund im Ergebnis', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/user', CLAUDE_CODE_REMOTE: 'true', SESSION_JOURNAL_TOKEN: 'vct_test' })
  const world = engine(on, [{ status: 400, text: JSON.stringify({ error: 'Titel fehlt', field: 'titel' }) }])
  const out = await run($, clock)
  expect(world.requests.length).toBe(1)
  expect(JSON.stringify(out)).toContain('Titel fehlt')
})

test('lokal: unverändert in die Datei', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/user' })
  const world = engine(on, [])
  await run($, clock)
  expect(world.requests.length).toBe(0)
  expect(world.files.get('/home/user/journal/arbeit/2026-01-05.md')).toContain('### 09:00–09:20 · Remote-Block')
})

test('render-Fixture stimmt mit dem Cockpit überein', () => {
  const f = fixtureJson as Record<string, unknown> & { from: string; to: string; session: string }
  const entry = parseEntry(JSON.stringify(f), 'privat')!
  expect(renderEntry(entry, Date.parse(f.from), Date.parse(f.to), f.session, 'manual')).toBe(fixtureMd)
})
