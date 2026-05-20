# Fáza 5 – Styling

## Vytvorený súbor
- `styles.css`

## Filozofia
- Výhradne Obsidian CSS variables (`--background-primary`, `--interactive-accent`, …)
- Automaticky funguje v light aj dark téme
- Žiadne pevne zakódované farby

## Kľúčové triedy

| Trieda | Popis |
|--------|-------|
| `.cc-root` | Flex column, výška 100% panelu |
| `.cc-messages` | Flex column, `overflow-y: auto`, gap medzi správami |
| `.cc-msg--user` | Pravá strana, `--interactive-accent` pozadie |
| `.cc-msg--assistant` | Ľavá strana, `--background-secondary` |
| `.cc-msg--loading` | Spinner placeholder počas generovania |
| `.cc-tool-block` | Ohraničený blok, header je kliknuteľný toggle |
| `.cc-tool-body--open` | Zobrazí telo tool bloku |
| `.cc-spinner` | CSS rotating border animation |
| `.cc-input` | Textarea s focus ring (`--interactive-accent`) |
| `.cc-send-btn` | Primárne tlačidlo (`--interactive-accent`) |
