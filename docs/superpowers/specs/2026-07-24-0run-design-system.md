# 0run — Design System UI

**Vincolante per tutta la UI di `apps/web`.** Riscritto il 2026-07-25 **dal codice in produzione**, non viceversa: la versione precedente descriveva un sistema "Luxury/Editorial" con radius 0 ovunque che l'implementazione ha superato, e la divergenza ha già costretto un implementer a scegliere quale fonte seguire. Se in futuro codice e questo documento divergono di nuovo, si aggiorna il documento **dopo** aver deciso consapevolmente, non lo si lascia mentire.

## Due registri, non uno

Il prodotto ha due superfici con obiettivi diversi, e questo è deliberato:

| | **Registro editoriale** (pubblico) | **Registro app** (post-login) |
|---|---|---|
| Route | `/`, `/technology`, `/coach/[tokenId]`, `/coaches`, `/events` | tutto sotto `app/(app)/`: dashboard, mint, upload, runs, coach |
| Obiettivo | farsi ricordare: è la vetrina, la prima cosa che vede un giudice | farsi usare: è un'app da telefono, in mano mentre sudi |
| Chrome | `<PageChrome />` — rumore di carta al 2% + 4 gridline verticali navy/20 | `<AppShell />` — barra superiore sticky + tab bar inferiore fissa |
| Scala tipografica | estrema: hero `text-6xl`→`text-9xl`, `leading-[0.9]` | contenuta: `text-2xl`→`text-4xl` per i titoli |
| Superfici | trasparenti, definite da linee e bordi singoli | card morbide traslucide, ombre leggere |
| Composizione | griglia 12 colonne asimmetrica, offset di colonna, mai centrata | verticale, phone-first, una colonna che scala |

**La cucitura nota**: i componenti condivisi (`Button`, `Card`, `Input`) hanno lo stile morbido del registro app e vengono usati **anche** nelle pagine editoriali — per esempio le tre card di "how it works" nella landing sono `rounded-2xl`. È accettato: il contrasto è tenue e il costo di una variante editoriale non si giustifica. Se un giorno stona, si aggiunge una variante a `Card`, non si irrigidisce tutto.

## Token — l'unico universo di colore

```css
--color-cream:  #EFEFD0   /* sfondo pagina */
--color-navy:   #004E89   /* testo primario, bordi */
--color-peach:  #F7C59F   /* superfici elevate, stati evidenziati */
--color-ocean:  #1A659E   /* testo secondario, caption, metadata */
--color-orange: #FF6B35   /* accento: hover, focus, enfasi, marker */
```

Definiti in `apps/web/src/app/globals.css` sotto `@theme`. **Nessun valore hex nei componenti** — si usano le classi token (`bg-cream`, `text-navy`, `border-orange`…). Unica eccezione legittima: valori passati a librerie terze che non leggono Tailwind (la polyline di Leaflet in `run-map.tsx`, con una costante nominata e commentata).

**Bianco**: ammesso solo come *superficie traslucida* (`bg-white/40`, `bg-white/45`, `bg-white/50`) sopra il cream, mai come sfondo pieno di pagina. È ciò che dà alle card l'aspetto morbido senza introdurre un sesto colore.

**Arancione**: accento, non superficie. Hover, focus, marker, parole in italic dentro headline grandi, badge. Mai un riempimento ampio. **Attenzione contrasto**: orange su cream è ~2,4:1 — vietato per testo piccolo statico; ammesso su testo grande, elementi decorativi e stati hover. Il testo piccolo è navy (~7,3:1, AAA) oppure ocean (~5,3:1, AA).

## Tipografia

- **Playfair Display** per i titoli (`font-serif`), **Inter** per corpo e UI (`font-sans`), caricati con `next/font/google` in `app/layout.tsx` come variabili CSS.
- **Playfair non ha il peso 300**: Google Fonts non lo pubblica (né statico né come minimo dell'asse variabile) e i tipi generati da `next/font` lo rifiutano. Pesi disponibili: 400 normale e 400 italic. Non riproporlo.
- Inter: 400 e 500 (il 500 per bottoni e label).
- **Micro-label**: `text-xs` o `text-[10px]`, MAIUSCOLO, `tracking-[0.25em]`–`[0.3em]`. Sono la firma tipografica del prodotto e valgono in entrambi i registri.
- **Headline**: `leading-[0.9]` o `leading-tight`, con una parola in `italic text-orange` come enfasi. Corpo: `leading-relaxed`, tracking di default (il corpo non si tocca mai).
- Testo allineato a sinistra, mai giustificato.

## Componenti condivisi (valori reali)

**Button** (`components/ui/button.tsx`) — `h-12`, `rounded-xl`, `px-8`, uppercase `text-xs tracking-[0.2em]`, focus ring navy/60 con offset su cream.
- `primary`: `bg-navy` testo cream, `shadow-sm` → `hover:shadow-md`. **Conserva l'animazione firma**: un layer arancione che entra da sinistra (`-translate-x-full` → `translate-x-0`, `duration-500`, easing `cubic-bezier(0.25,0.46,0.45,0.94)`), con il testo sopra via z-index. Questa non si tocca: è l'unico gesto di movimento riconoscibile del prodotto.
- `secondary`: bordo `navy/25` su `bg-white/40`, hover riempie di navy.
- `link`: solo testo, hover arancione con underline.

**Card** (`components/ui/card.tsx`) — `rounded-2xl`, `p-6`/`md:p-8`, `shadow-sm` → `hover:shadow-md`, `duration-500`. Default: bordo `navy/10` su `bg-white/45`. `featured`: bordo `orange/70` su `bg-peach/30`.

**Input** (`components/ui/input.tsx`) — `h-12`, `rounded-xl`, bordo `navy/20` su `bg-white/50`, `shadow-sm`, focus bordo arancione + `ring-2 ring-orange/25`, `duration-300`. **Placeholder in Playfair italic** color ocean: è il dettaglio che tiene insieme i due registri anche nei form.

Le textarea seguono lo stile dell'Input (non esiste una primitiva dedicata).

## Movimento

- Default **500ms** su colori, ombre, trasformazioni; 300ms sugli input (reattività percepita nei form); **1500–2000ms** sul reveal grayscale→colore delle immagini.
- Easing `ease-out` o la cubic-bezier custom. Mai `ease-in`/`ease-in-out`, mai snap.
- **`prefers-reduced-motion`** è gestito globalmente in `globals.css`: durate a 0, transform annullati, i cambi di colore restano. Non reintrodurre movimento che lo ignori.

## Immagini e mappe

Grayscale di default, colore al hover con `duration-[1500ms]`, spesso con `group-hover:scale-105` e ombra che si approfondisce. Aspect ratio verticali (`aspect-[3/4]`, `aspect-[4/5]`). La mappa del percorso (`run-map.tsx`) segue lo stesso trattamento e mostra uno stato vuoto onesto quando la corsa non ha polyline — mai una mappa finta.

## Elementi di firma da mantenere

1. Linee decorative `h-px w-8`/`w-12` prima delle micro-label maiuscole.
2. Parole in `italic text-orange` dentro le headline.
3. Label verticali `writing-mode: vertical-rl` (decorative, solo desktop) nelle pagine editoriali.
4. Drop cap Playfair (`first-letter:float-left first-letter:text-7xl`) sul paragrafo introduttivo di manifesto e report.
5. Gridline verticali + rumore di carta nelle pagine pubbliche (`PageChrome`).
6. L'animazione arancione del bottone primario.
7. Numeri e passi in serif italic arancione (`01`, `02`, `03`).

## Accessibilità

Contrasti verificati: navy su cream ~7,3:1 (AAA); ocean su cream ~5,3:1 (AA); cream su navy ~7,3:1 (AAA); orange su cream ~2,4:1 (**solo decorativo o testo grande**). Focus sempre visibile — i componenti condivisi portano un ring navy con offset; non rimuoverlo, non sostituirlo con `outline: none` nudo. Touch target ≥48px (`h-12`, oppure `py-3` sui link testuali). `prefers-reduced-motion` rispettato.

## Onestà nella copy (regola di prodotto, non di stile)

La UI non afferma ciò che non abbiamo verificato. Casi concreti già in codice: il badge di attestazione mostra "TEE verified" **solo** se `verifiedTee === "true"`, altrimenti dice "attestation not available"; il badge coach dice **"autodichiarato"**, mai "verified"; la mappa mostra uno stato vuoto invece di una mappa vuota; i numeri citati sono misurati (vedi `docs/0g-reality-check.md`), mai stimati. La home parla di **benefici** al pubblico e manda la tecnologia su `/technology`.

## Anti-pattern

Colori fuori dai cinque token · hex nei componenti · bianco come sfondo pieno · testo piccolo arancione su cream · animazioni sotto i 300ms o che ignorano `prefers-reduced-motion` · font oltre Playfair e Inter · icone prominenti (lucide-react, stroke sottile, rare) · arancione come superficie · immagini senza grayscale · tracking largo sul corpo del testo · mobile come stack generico invece dell'estetica scalata · badge o copy che affermano verifiche non avvenute.
