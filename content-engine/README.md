# content-engine

Automasjonskanal for UGC-innhold: fra vettet Whop-produkt til publisert video på
YouTube Shorts, Instagram Reels og TikTok — uten at PC-en din trenger å stå på.

Motoren er GitHub Actions. Køen er git. Ingen server, ingen database, ingen abonnement
utover API-nøklene.

---

## Hvordan det henger sammen

```
config/whop.sources.json     ← her bestemmer du hva som skal lages
        │
        ▼
   1-source      Produkt blir til en brief            → queue/01-brief
   2-script      Claude skriver manus + 3 captions    → queue/03-render
   3-render      Manus blir til video                 → queue/04-ready
   4-publish     Video ut på alle tre plattformer     → queue/05-published
   5-stats       Tall skrives tilbake på videoen
```

Hvert innholdselement er **én JSON-fil** som flytter seg mellom mappene i `queue/`.
Det betyr at hele historikken ligger i git, at alt kan feilsøkes med `cat` og `jq`,
og at et hvilket som helst steg trygt kan kjøres på nytt.

## Kom i gang

```bash
npm install
cp .env.example .env          # fyll inn nøkler — se docs/SETUP.md
npm run dry                   # hele syklusen uten å røre noe eksternt
```

Deretter, i denne rekkefølgen:

1. **Fyll inn `config/channel.config.json`** — navn, nisje, målgruppe, stemme.
   `name` står som `CHANGE ME` til du gjør det.
2. **Legg inn minst ett produkt** i `config/whop.sources.json` → `manualProducts`,
   med `enabled: true`. Les `.claude/skills/whop-ugc-sourcing/SKILL.md` først — den
   beskriver hva som faktisk er verdt å lage video om.
3. **Legg nøklene inn som GitHub-secrets** (`docs/SETUP.md` går gjennom hver enkelt).
4. **Kjør workflowen `Pipeline` manuelt** med `dry_run` huket av, og se at den grønner.

## Kommandoer

| Kommando | Hva den gjør |
| --- | --- |
| `npm run source` | Henter nye produkter og lager briefer |
| `npm run script` | Skriver manus og captions med Claude |
| `npm run render` | Lager eller henter videofila |
| `npm run publish` | Publiserer neste ferdige video |
| `npm run stats` | Henter tall på publiserte videoer |
| `npm run health` | **Start her når noe er galt** — viser kødybde og alt som blokkerer |
| `npm run cycle` | Hele produksjonssyklusen |
| `npm run dry` | Samme, men uten å røre noen ekstern tjeneste |

## Rendering: to måter

`RENDERER=manual` (standard) — pipelinen venter på at du slipper en eksport inn i
`media/inbox/<item-id>.mp4`. Klipp i Crayo, Descript, OpenCut, CapCut — hva du vil.
Elementer uten fil blir liggende i `03-render`, og det er **ikke** en feil.

`RENDERER=ffmpeg` — helautomatisk: ElevenLabs leser inn manuset, ffmpeg legger det over
en b-roll-klipp fra `media/broll/`, brenner inn captions og mikser musikk under.
Kjører på GitHub sine runnere uten oppsett.

## Rytme og sikkerhetsnett

Grensene i `config/channel.config.json` håndheves **inne i publiseringssteget**, ikke av
cron. Det betyr at en manuell kjøring aldri kan presse kanalen forbi dagsgrensen.

- Affiliate-disclosure legges på **etter** at modellen er ferdig, så den kan ikke
  skrives bort.
- `bannedClaimPatterns` blokkerer garantier, «risk-free» og gangeklaimer — det er de
  formuleringene som får kontoer begrenset.
- `health.yml` kjører hver morgen og åpner en issue hvis kanalen er i ferd med å bli
  stille. En stille kanal som ingen oppdager er den dyreste feilen som finnes her.

## Dokumentasjon

| Fil | Innhold |
| --- | --- |
| `docs/SETUP.md` | Hver eneste nøkkel, steg for steg |
| `docs/ARCHITECTURE.md` | Hvorfor det er bygget slik |
| `bootstrap/STATION-D.md` | Oppsett på D:-stasjonen på Windows |
| `.claude/skills/` | Seks skills — sourcing, manus, render, publisering, tall, triage |
| `CLAUDE.md` | Instruksjoner for Claude Code i denne repoen |

## Når noe ryker

```bash
npm run health
```

Den navngir problemet i klartekst. Deretter:
`.claude/skills/pipeline-triage/SKILL.md`.
