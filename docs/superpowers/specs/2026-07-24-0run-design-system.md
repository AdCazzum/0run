# 0run — Design System UI: Luxury / Editorial

**Vincolante per tutta la UI di `apps/web`.** Fornito da Ivan il 2026-07-24; palette colori custom di Ivan (sostituisce il monocromo+oro dello stile originale — le *regole d'uso* dei colori restano identiche, cambiano i valori). Ogni componente, pagina e micro-interazione segue queste regole; in caso di dubbio, vince questo documento.

## Filosofia

Eleganza per sottrazione: riviste di moda high-end (Vogue, Kinfolk) e brand luxury (Aesop, Hermès). Tipografia impeccabile, spazio negativo generoso, motion lento e cinematografico, asimmetria intenzionale, profondità per ombre sottili. Vibe: sofisticato, senza tempo, costoso, sereno, curato, editoriale, tattile. Il lusso non aggiunge decorazione — rimuove il superfluo e perfeziona ciò che resta.

## Token

### Colori (palette 0run)

| Token | Valore | Uso |
|---|---|---|
| Background | `#EFEFD0` (Cream) | sfondo pagina — mai bianco puro |
| Foreground | `#004E89` (Deep Navy) | testo primario, bordi, sezioni scure |
| Muted BG | `#F7C59F` (Peach) | superfici elevate, sezioni alternate, stati disabled |
| Muted FG | `#1A659E` (Ocean Blue) | testo secondario, caption, metadata, link |
| Accent | `#FF6B35` (Vivid Orange) | SOLO hover, underline, focus, micro-dettagli, badge — mai aree grandi |
| Accent FG | `#EFEFD0` (Cream) | testo su sfondi navy o orange |

- Bordi/divider: `#004E89` al 10-20% di opacità.
- Sezioni scure: palette invertita (`#004E89` bg, `#EFEFD0` testo, `#F7C59F` muted al 60-80%).
- L'orange eredita TUTTE le regole del gold originale: è la ricompensa dell'interazione (hover, focus, dettagli), mai il colore dominante di una superficie.

### Tipografia (l'elemento più critico)

- **Headings**: "Playfair Display" (serif alto contrasto) — Regular 400, Light 300 per contrasto, Italic per enfasi.
- **Body/UI**: "Inter" — Medium 500 per bottoni/link, Regular 400 body.
- **Scala**: hero `text-6xl`→`text-9xl` con `leading-[0.9]`; sezioni `text-5xl`→`text-7xl`; card `text-3xl`/`text-4xl`; body `text-base`/`text-lg` con `leading-relaxed`; overline `text-xs` UPPERCASE; micro `text-[10px]`.
- **Tracking**: label uppercase `tracking-[0.25em]`–`[0.3em]`; bottoni `tracking-[0.2em]`; headline `tracking-tight`; body default (mai modificato).

### Forme, bordi, ombre

- **Border-radius: 0px ovunque.** Precisione architetturale, nessuna eccezione.
- Bordi sempre `1px`; spesso solo un lato (`border-t`); divider come `h-px`/`w-px`.
- Ombre sottilissime, mai dure: card `shadow-[0_2px_8px_rgba(0,0,0,0.02)]` → hover `[0_8px_24px_rgba(0,0,0,0.06)]`; hero image `[0_8px_32px_rgba(0,0,0,0.12)]`; bottoni primari `[0_4px_16px_rgba(0,0,0,0.15)]` → hover più profonda. Inner border su immagini: `shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04-0.08)]`.
- **Noise di carta**: overlay SVG fractal noise al 2% su tutta la pagina (fixed, pointer-events-none, z-50).

### Immagini

Default **grayscale**, colore al hover con transizione `duration-[1500ms]`–`[2000ms]` + `group-hover:scale-105` + ombra che si approfondisce. Aspect ratio verticali (`aspect-[3/4]`, `aspect-[4/5]`), immagini grandi e prominenti. Con questa palette il reveal a colori è ancora più forte: il grayscale di default resta obbligatorio.

### Griglia

12 colonne, container `max-w-[1600px]`, padding `px-8`/`px-16`. **4 gridline verticali visibili** (fixed, `w-px`, `bg-[#004E89]/20`, pointer-events-none) ai bordi delle colonne. Composizione **asimmetrica**: 7/5, offset `col-start-2`/`col-start-6`, allineamento bottom-left — mai tutto centrato, mai 50/50.

## Componenti

- **Button primary**: `bg-[#004E89]` testo cream, `h-12`, `px-8+`, uppercase `text-xs tracking-[0.2em]`; hover = layer orange (`#FF6B35`) che slitta da sinistra (`translate-x-[-100%]` → `0`, `duration-500`, `cubic-bezier(0.25,0.46,0.45,0.94)`, span interni con z-index, testo cream sopra).
- **Button secondary**: trasparente + `border border-[#004E89]` testo navy; hover riempie di navy, testo inverte a cream, `duration-500`.
- **Card**: sfondo trasparente, solo `border-t` navy, padding `p-8`/`p-12`, hover appena percettibile (`hover:bg-[#F7C59F]/20`). Card in evidenza: `border-t-4 border-t-[#FF6B35]`.
- **Input**: solo `border-b` navy, sfondo trasparente, `h-12`, focus → bordo orange, nessun ring/glow. Placeholder in **Playfair italic** ocean blue.
- **Timing**: interazioni ≥500ms, colori 700ms, immagini 1500-2000ms, easing `ease-out` o la cubic-bezier custom — mai `ease-in`/`ease-in-out`, niente snap.

## Bold factor (firma riconoscibile, obbligatori)

1. Label verticali `writing-mode: vertical-rl` (decorative, desktop only) — es. "0run / Vol. 01".
2. Drop cap Playfair `text-7xl` `float-left` sul paragrafo introduttivo.
3. Headline con *parole in italic orange* alternate ("The *Coach*", "Every *Run*").
4. Grayscale→colore su tutte le immagini (incluse mappe delle corse dove sensato).
5. Gridline verticali visibili (navy al 20%).
6. Orange slide sui bottoni primari.
7. Linee orizzontali decorative (`h-px w-8/w-12`) prima delle label.
8. Scala tipografica estrema (hero enorme + micro-label).
9. Ombre stratificate soft.
10. Interazioni coordinate multi-layer (border orange + padding + avatar a colori sui blocchi tipo testimonial/crew).

## Anti-pattern (vietati)

Rounded corners · ombre dure · #000/#FFF puri come testo/sfondo · animazioni <500ms · colori fuori palette (i 5 token sono l'universo intero) · tutto centrato · spaziatura stretta · font decorativi oltre Playfair+Inter · icone prominenti (solo lucide-react, stroke sottile, rare) · orange dominante · immagini piccole · tracking largo sul body · immagini senza grayscale · mobile "generico" (l'estetica si mantiene, scalata: `py-20`, `text-5xl` hero, stack verticale).

## Accessibilità (contrasti verificati per questa palette)

- Navy `#004E89` su Cream `#EFEFD0`: **~7.3:1** — AAA, testo primario ok.
- Ocean Blue `#1A659E` su Cream: **~5.3:1** — AA, ok per testo secondario.
- Cream su Navy (sezioni scure): **~7.3:1** — AAA.
- Orange `#FF6B35` su Navy: **~3:1** — solo testo grande/elementi UI, non testo piccolo.
- Orange su Cream: **~2.4:1** — SOLO elementi decorativi/grandi (linee, badge, italic in headline grandi); mai testo piccolo orange su cream: per il testo si usa navy o ocean blue.
- Focus visibile sempre (ring-1 navy o bordo orange, mai rimosso). `prefers-reduced-motion`: durate a 0, mantenere i cambi colore, togliere transform/scale. Touch target ≥48px (`h-12`). Testo allineato a sinistra, mai giustificato.

## Note d'implementazione per 0run

- Tailwind CSS v4, token centralizzati in config (mai valori sparsi one-off); Google Fonts Playfair Display + Inter; lucide-react parco.
- Componenti base da costruire subito: `Button` (primary/secondary/link), `Card` (border-top + shadow evolution), `Input` (underline + placeholder italic), overlay noise + gridlines nel layout root.
- Applicazione ai momenti chiave dell'app: la **pipeline a stati dell'upload** è una sequenza editoriale (label uppercase, linee decorative, spunte lente in orange); la **mappa del percorso** entra in grayscale e prende colore; il **badge "TEE verified"** è un micro-dettaglio orange; il **report del coach** usa drop cap e headline con italic orange; le **card corsa** usano aspect verticali e border-top; le **personalità del coach** (Pacer/Coach/Drill Sergeant) possono usare Muted BG peach per differenziare le card in selezione.
