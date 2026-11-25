// Copy of vault-cockpit test/fixtures/journal-entry.{json,md}: both renderers must agree.
export const fixtureJson = {
  "titel": "Beispielblock",
  "sphaere": "privat",
  "projekt": "demo",
  "kontext": "Ein synthetischer Testblock.",
  "punkte": [
    "Erster Punkt",
    "Zweiter Punkt"
  ],
  "erkenntnis": "Ein übertragbares Learning.",
  "offen": "Rest für morgen.",
  "from": "2026-01-05T08:00:00Z",
  "to": "2026-01-05T08:40:00Z",
  "session": "abcdef1234567890",
  "kind": "manual"
}

export const fixtureMd = "### 09:00–09:40 · Beispielblock\n- **Projekt:** demo · **Session:** `abcdef12` · manual\n- **Kontext:** Ein synthetischer Testblock.\n- Erster Punkt\n- Zweiter Punkt\n- 💡 **Erkenntnis:** Ein übertragbares Learning. #mycel-candidate\n- ⏳ **Offen:** Rest für morgen.\n"
