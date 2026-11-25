# session-journal

Claude-Code-Mod, der abgeschlossene Arbeitsblöcke einer Session automatisch in ein Tagesjournal schreibt. Grundlage für Tages- und Wochen-Reviews, Zeiterfassung und Wissensarbeit, ohne dass man selbst ans Mitschreiben denken muss.

## Wie es arbeitet

- Nach einer Antwort des Agenten prüft der Mod, ob seit dem letzten Versuch mindestens 30 Minuten vergangen sind und ein neuer Prompt kam.
- Dann fragt er das Session-Modell über den warmen Prompt-Cache (`$.model.fork`), ob ein Arbeitsblock abgeschlossen ist. Antwort: ein kurzer JSON-Eintrag oder `SKIP`.
- Vor `/clear` schreibt er einen Abschluss, `/journal` schreibt sofort einen Eintrag.
- Einträge landen in `<journal_dir>/<privat|arbeit>/YYYY-MM-DD.md`, mit Zeitspanne, Projekt, Kontext, 2–4 Stichpunkten, optional einer Erkenntnis (`#mycel-candidate`) und Offenem.
- Regeln im Prompt: keine Implementierungsdetails, keine Personennamen, bei Arbeit keine Kundennamen. Zugangsdaten maskiert zusätzlich `$.session.redact`.

## Installation

```fish
claude plugin marketplace add ~/dev/personal/session-journal
claude plugin install session-journal@session-journal
```

Edits im Ordner wirken nach `/reload-plugins`.

## Konfiguration

- `journal_dir` (Standard `~/journal`): Ablageordner.
- `work_paths` (Standard `/dev/work/`): kommagetrennte Pfadteile, die als Sphäre `arbeit` vorbelegt werden.
- `cockpit_url` (Standard `https://vault.rubeen.dev`): Ziel in Cloud-Sessions, siehe unten.

Setzen über `/config` oder `pluginConfigs` in den User-Settings.

## Cloud-Sessions (Claude Code im Web)

Ist `CLAUDE_CODE_REMOTE=true`, schreibt der Mod nicht in `journal_dir` (der Container ist danach weg), sondern schickt den Eintrag per `POST <cockpit_url>/journal` ans Vault Cockpit. Das hängt ihn an dieselbe Tagesdatei `_System/journal/<sphäre>/<tag>.md` an, mit `· code-web` am Ende der Projektzeile. Einen Fehlschlag versucht er einmal erneut; doppelte Einträge verwirft das Cockpit.

Einrichtung der Cloud-Umgebung:

1. Im Cockpit unter **Einstellungen → API-Tokens** einen Token mit Recht **Journal** anlegen.
2. In der Umgebung `SESSION_JOURNAL_TOKEN=vct_…` als Umgebungsvariable setzen und `vault.rubeen.dev` in die Netzwerk-Freigabe aufnehmen.
3. Ins Setup-Script (verträgt mehrfache Läufe):

```bash
claude plugin marketplace list 2>/dev/null | grep -q session-journal \
  || claude plugin marketplace add rubenvitt/session-journal
claude plugin list 2>/dev/null | grep -q 'session-journal@session-journal' \
  || claude plugin install session-journal@session-journal
```

Das Repo ist privat: Kommt die Umgebung nicht per GitHub-Anmeldung heran, das Repo in der Umgebung als Quelle anhängen und `marketplace add <Pfad zum Checkout>` nehmen.

In Sessions der Claude-App laufen Mods nicht; dort schreibt der Skill `/journal` über das MCP-Werkzeug `vault_journal`.

## Kosten

Jeder Versuch ist ein zusätzlicher Modellaufruf über den gecachten Verlauf, auch wenn `SKIP` zurückkommt. Er läuft über die Anmeldung der Session und erscheint in `/usage` unter den Mod-Aufrufen.

## Entwicklung

```fish
claude plugin validate .
claude plugin test .
tsc -p .
```
