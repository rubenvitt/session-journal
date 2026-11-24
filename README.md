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

Setzen über `/config` oder `pluginConfigs` in den User-Settings.

## Kosten

Jeder Versuch ist ein zusätzlicher Modellaufruf über den gecachten Verlauf, auch wenn `SKIP` zurückkommt. Er läuft über die Anmeldung der Session und erscheint in `/usage` unter den Mod-Aufrufen.

## Entwicklung

```fish
claude plugin validate .
claude plugin test .
tsc -p .
```
