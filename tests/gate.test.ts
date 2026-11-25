import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60 * 1000
// 2026-01-05 09:00 Europe/Berlin (UTC+1), synthetic
const START = Date.UTC(2026, 0, 5, 8, 0)

const ENTRY = JSON.stringify({
  titel: 'Beispielblock',
  sphaere: 'privat',
  projekt: 'demo',
  kontext: 'Ein synthetischer Testblock.',
  punkte: ['Erster Punkt', 'Zweiter Punkt'],
  erkenntnis: '',
  offen: '',
})

function engine(on: On, reply: string | (() => string)) {
  const files = new Map<string, string>()
  const forks: string[] = []
  on('command.register', () => ({ value: { command: 'journal' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => e as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.id', () => ({ value: 'session-0000-test' }))
  on('session.cwd', () => ({ value: '/home/test/project' }))
  on('session.usage', () => ({ value: { startedAt: START } }) as never)
  on('session.redact', (_, e) => ({ value: (e as { text: string }).text }))
  on('model.fork', (_, e) => {
    forks.push((e as { prompt: string }).prompt)
    return { value: { isAnswered: true, text: typeof reply === 'string' ? reply : reply(), usage: {} } } as never
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.read', (_, e) => ({ value: files.get((e as { path: string }).path) ?? '' }) as never)
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  return { files, forks }
}

test('no fork before 30 minutes, one after', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/test' })
  const world = engine(on, ENTRY)

  await $.session.start({ cwd: '/home/test/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hallo' } as never)
  await clock.advance(10 * MIN)
  await $.turn.complete({ answer: 'ok', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.settle()
  expect(world.forks.length).toBe(0)

  await $.prompt.submit({ text: 'weiter' } as never)
  await clock.advance(25 * MIN)
  await $.turn.complete({ answer: 'ok', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't2' } as never)
  await clock.settle()
  expect(world.forks.length).toBe(1)

  const file = world.files.get('/home/test/journal/privat/2026-01-05.md')
  expect(file).toContain('### 09:00–09:35 · Beispielblock')
  expect(file).toContain('type: journal')

  // Right after a try, the gate is closed again.
  await $.prompt.submit({ text: 'noch was' } as never)
  await $.turn.complete({ answer: 'ok', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't3' } as never)
  await clock.settle()
  expect(world.forks.length).toBe(1)
})

test('SKIP writes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/test' })
  const world = engine(on, 'SKIP')

  await $.session.start({ cwd: '/home/test/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hallo' } as never)
  await clock.advance(31 * MIN)
  await $.turn.complete({ answer: 'ok', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.settle()
  expect(world.forks.length).toBe(1)
  expect(world.files.size).toBe(0)
})

test('/journal after an auto entry names the last entry on SKIP', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/test' })
  let reply = ENTRY
  engine(on, () => reply)

  await $.session.start({ cwd: '/home/test/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hallo' } as never)
  await clock.advance(31 * MIN)
  await $.turn.complete({ answer: 'ok', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.settle()

  reply = 'SKIP'
  await clock.advance(5 * MIN)
  const out = await $.command.run({ command: 'journal', args: '' } as never)
  expect(JSON.stringify(out)).toContain('Nichts Neues seit 09:31 Uhr, letzter Eintrag 09:31: „Beispielblock“')
})
