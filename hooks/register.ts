import type { Register, EngineInterface } from 'claude-code'

// Session journal: after a finished work block (at most every 30 minutes, and
// only when a prompt came in since the last try) the session's own model is
// forked over the warm cache and asked whether a block of work is done. If so,
// it writes a short entry into a per-day, per-sphere Markdown file; else SKIP.
// Before /clear a closing entry is written, and /journal writes one on demand.

const GATE_MS = 30 * 60 * 1000
const TIME_ZONE = 'Europe/Berlin'

type Kind = 'auto' | 'manual' | 'final'
type Sphere = 'privat' | 'arbeit'

type Entry = {
  titel: string
  sphaere: Sphere
  projekt: string
  kontext: string
  punkte: string[]
  erkenntnis?: string
  offen?: string
}

type Outcome =
  | { written: true; entry: Entry; file: string }
  | { written: false; reason: string; from?: number }

// Module state, reset on reload; the gate simply starts over then.
let lastAttemptAt = 0
let promptsSinceAttempt = 0
let blockStartAt: number | undefined
let lastEntryAt: number | undefined
let lastEntryTitle: string | undefined
let isBusy = false

const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, ...opts }).format(new Date(ms))

const hhmm = (ms: number) => fmt(ms, { hour: '2-digit', minute: '2-digit' })

const isoDay = (ms: number) => {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

const germanDay = (ms: number) =>
  fmt(ms, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })

const oneLine = (s: unknown, max = 300) =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : ''

export function parseEntry(text: string, fallbackSphere: Sphere): Entry | undefined {
  const trimmed = text.trim()
  if (/^SKIP\b/i.test(trimmed)) return undefined
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return undefined
  }
  const titel = oneLine(raw.titel, 80)
  const punkte = Array.isArray(raw.punkte)
    ? raw.punkte.map(p => oneLine(p, 240)).filter(p => p.length > 0).slice(0, 5)
    : []
  if (titel === '' || punkte.length === 0) return undefined
  const sphaere: Sphere =
    raw.sphaere === 'arbeit' || raw.sphaere === 'privat' ? raw.sphaere : fallbackSphere
  return {
    titel,
    sphaere,
    projekt: oneLine(raw.projekt, 60) || 'unbekannt',
    kontext: oneLine(raw.kontext),
    punkte,
    erkenntnis: oneLine(raw.erkenntnis) || undefined,
    offen: oneLine(raw.offen) || undefined,
  }
}

export function renderEntry(
  entry: Entry,
  from: number,
  to: number,
  sessionId: string,
  kind: Kind,
): string {
  const lines = [
    `### ${hhmm(from)}–${hhmm(to)} · ${entry.titel}`,
    `- **Projekt:** ${entry.projekt} · **Session:** \`${sessionId.slice(0, 8)}\` · ${kind}`,
  ]
  if (entry.kontext) lines.push(`- **Kontext:** ${entry.kontext}`)
  for (const p of entry.punkte) lines.push(`- ${p}`)
  if (entry.erkenntnis) lines.push(`- 💡 **Erkenntnis:** ${entry.erkenntnis} #mycel-candidate`)
  if (entry.offen) lines.push(`- ⏳ **Offen:** ${entry.offen}`)
  return lines.join('\n') + '\n'
}

const fileHeader = (day: string, at: number, sphere: Sphere) =>
  [
    '---',
    'type: journal',
    `date: ${day}`,
    `sphere: ${sphere}`,
    '---',
    '',
    `# Journal ${germanDay(at)} · ${sphere}`,
    '',
    '',
  ].join('\n')

function buildPrompt(kind: Kind, since: string, defaultSphere: Sphere): string {
  const task =
    kind === 'auto'
      ? 'Prüfe, ob im Verlauf seit dem genannten Zeitpunkt ein Arbeitsblock abgeschlossen ist (ein Thema bearbeitet, ein Ergebnis erreicht oder bewusst liegen gelassen). Läuft die Arbeit noch mitten im selben Thema, ist nichts abgeschlossen: antworte dann exakt SKIP.'
      : kind === 'final'
        ? 'Die Session wird gleich geleert. Fasse die Arbeit seit dem genannten Zeitpunkt als Abschluss zusammen. Nur wenn seitdem nichts Nennenswertes passiert ist, antworte exakt SKIP.'
        : 'Fasse die Arbeit seit dem genannten Zeitpunkt als Journal-Eintrag zusammen. Nur wenn seitdem nichts Nennenswertes passiert ist, antworte exakt SKIP.'
  return [
    '[Journal-Mod: interne Anfrage, keine Antwort an den Nutzer. Du hast keine Werkzeuge. Antworte sofort, ohne langes Nachdenken.]',
    '',
    `Zeitpunkt: ${since}. Alles davor ist bereits erfasst und zählt nicht.`,
    task,
    '',
    'Sonst antworte ausschließlich mit einem JSON-Objekt, ohne Codeblock:',
    '{"titel": "Kurztitel, höchstens 60 Zeichen", "sphaere": "privat" oder "arbeit", "projekt": "Projekt- oder Repo-Name", "kontext": "ein Satz: worum es ging", "punkte": ["2 bis 4 Stichpunkte: was getan, was erreicht"], "erkenntnis": "ein übertragbares Learning fürs Wiki, sonst leer", "offen": "was liegen blieb, sonst leer"}',
    '',
    'Regeln:',
    '- Deutsch mit echten Umlauten (ä, ö, ü, ß).',
    '- Tätigkeiten und ihr Kontext. Keine Implementierungsdetails, keine Dateipfade, keine Codezeilen.',
    '- Keine Personennamen. Bei Arbeit keine Kunden-, Firmen- oder Produktnamen von Kunden; neutral umschreiben.',
    '- Keine Zugangsdaten, Tokens, Mailadressen, Gesundheits- oder Finanzdetails.',
    '- Keine Formulierungen nach dem Muster „nicht X, sondern Y“.',
    `- sphaere: "arbeit" bei Beruflichem (Arbeitgeber, Kunden, Kollegen, Vorträge), sonst "privat". Vorgabe nach Arbeitsverzeichnis: "${defaultSphere}".`,
  ].join('\n')
}

async function expandHome($: EngineInterface, path: string): Promise<string> {
  if (!path.startsWith('~')) return path
  const home = await $.env.get('HOME')
  if (home === undefined) throw new Error('HOME is not set')
  return home + path.slice(1)
}

async function appendEntry($: EngineInterface, dir: string, entry: Entry, text: string, at: number) {
  const day = isoDay(at)
  const file = `${dir}/${entry.sphaere}/${day}.md`
  const exists = await $.fs.exists(file)
  const before = exists ? await $.fs.read(file) : fileHeader(day, at, entry.sphaere)
  const sep = before.endsWith('\n\n') || before === '' ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  await $.fs.write(file, before + sep + text)
  return file
}

type Config = { journalDir: string; workPaths: string[]; cockpitUrl: string }

// In a cloud session the container's files are gone afterwards: the entry goes
// to the Vault Cockpit (POST /journal) instead, which appends it to the same
// day file in the vault. One retry; the cockpit drops duplicates.
async function postEntry(
  $: EngineInterface,
  config: Config,
  entry: Entry,
  from: number,
  to: number,
  sessionId: string,
  kind: Kind,
): Promise<{ ok: true; path: string; duplicate: boolean } | { ok: false; reason: string }> {
  const token = await $.env.get('SESSION_JOURNAL_TOKEN')
  if (token === undefined || token === '') return { ok: false, reason: 'kein SESSION_JOURNAL_TOKEN' }
  const url = `${config.cockpitUrl.replace(/\/+$/, '')}/journal`
  const body = JSON.stringify({
    ...entry,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    session: sessionId,
    kind,
    source: 'code-web',
  })
  let last = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await $.http.fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body,
      })
      let parsed: { path?: string; reason?: string; error?: string } = {}
      try {
        parsed = JSON.parse(res.text)
      } catch {}
      if (res.ok) return { ok: true, path: parsed.path ?? url, duplicate: parsed.reason === 'duplicate' }
      last = `Cockpit ${res.status}${parsed.error ? `: ${parsed.error}` : ''}`
      if (res.status < 500) break
    } catch (err) {
      last = `Cockpit nicht erreichbar (${String(err)})`
    }
  }
  return { ok: false, reason: last }
}

async function journal($: EngineInterface, kind: Kind, config: Config): Promise<Outcome> {
  if (isBusy) return { written: false, reason: 'läuft schon' }
  isBusy = true
  try {
    const now = await $.clock.now()
    const sessionId = await $.session.id()
    const cwd = await $.session.cwd()
    const defaultSphere: Sphere = config.workPaths.some(w => cwd.includes(w)) ? 'arbeit' : 'privat'
    const from = blockStartAt ?? lastEntryAt ?? (await $.session.usage()).startedAt
    const since = `${germanDay(from)}, ${hhmm(from)} Uhr`

    const reply = await $.model.fork({ prompt: buildPrompt(kind, since, defaultSphere) })
    if (!reply.isAnswered) return { written: false, reason: `kein Ergebnis (${reply.reason})` }

    const entry = parseEntry(await $.session.redact(reply.text), defaultSphere)
    if (entry === undefined)
      return { written: false, reason: /^\s*SKIP\b/i.test(reply.text) ? 'SKIP' : 'Antwort nicht lesbar', from }

    const end = await $.clock.now()
    let file: string
    if ((await $.env.get('CLAUDE_CODE_REMOTE')) === 'true') {
      const sent = await postEntry($, config, entry, from, end, sessionId, kind)
      if (!sent.ok) return { written: false, reason: sent.reason }
      file = sent.duplicate ? `${sent.path} (schon vorhanden)` : sent.path
    } else {
      const dir = await expandHome($, config.journalDir)
      file = await appendEntry($, dir, entry, renderEntry(entry, from, end, sessionId, kind), end)
    }
    lastEntryAt = end
    lastEntryTitle = entry.titel
    blockStartAt = undefined
    return { written: true, entry, file }
  } finally {
    isBusy = false
  }
}

// Says why /journal wrote nothing: the auto hook may have just covered the block.
const skipText = (from: number) =>
  `📓 Nichts Neues seit ${hhmm(from)} Uhr` +
  (lastEntryAt !== undefined && lastEntryTitle !== undefined
    ? `, letzter Eintrag ${hhmm(lastEntryAt)}: „${lastEntryTitle}“`
    : '')

function report($: EngineInterface, r: Outcome) {
  if (r.written) $.ui.toast(`📓 Journal (${r.entry.sphaere}): ${r.entry.titel}`)
  // Trial phase: make silent failures visible; SKIP stays quiet.
  else if (r.reason !== 'SKIP' && r.reason !== 'läuft schon') $.ui.log(`session-journal: kein Eintrag (${r.reason})`)
}

export const register: Register = (on, options) => {
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v !== '' ? v : fallback)
  const config: Config = {
    journalDir: str(options?.journal_dir, '~/journal'),
    workPaths: str(options?.work_paths, '/dev/work/')
      .split(',')
      .map(w => w.trim())
      .filter(w => w !== ''),
    cockpitUrl: str(options?.cockpit_url, 'https://vault.rubeen.dev'),
  }

  on('session.start', async ($, e, next) => {
    lastAttemptAt = await $.clock.now()
    promptsSinceAttempt = 0
    await $.command.register({
      name: 'journal',
      description: 'Schreibt jetzt einen Eintrag ins Session-Journal',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    promptsSinceAttempt++
    blockStartAt ??= await $.clock.now()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || isBusy) return result
    const now = await $.clock.now()
    if (now - lastAttemptAt < GATE_MS || promptsSinceAttempt === 0) return result
    // Mark the attempt before forking: a fork's own events reach this hook too.
    lastAttemptAt = now
    promptsSinceAttempt = 0
    $.clock.after(0, () => {
      journal($, 'auto', config).then(
        r => report($, r),
        err => $.ui.log(`session-journal: Fehler ${String(err)}`),
      )
    })
    return result
  })

  on('command.run', { command: 'journal' }, async $ => {
    const r = await journal($, 'manual', config)
    lastAttemptAt = await $.clock.now()
    promptsSinceAttempt = 0
    return {
      text: r.written
        ? `📓 Eintrag „${r.entry.titel}“ → ${r.file}`
        : r.reason === 'SKIP' && r.from !== undefined
          ? skipText(r.from)
          : `📓 Kein Eintrag: ${r.reason}`,
      isTextDisplayOnly: true,
    }
  })

  on('command.run', { command: 'clear' }, async ($, e, next) => {
    $.ui.log('session-journal: Abschluss vor /clear', { to: 'debug' })
    if (blockStartAt !== undefined) {
      try {
        report($, await journal($, 'final', config))
      } catch (err) {
        $.ui.log(`session-journal: ${String(err)}`, { to: 'debug' })
      }
    }
    return next(e)
  })

}
