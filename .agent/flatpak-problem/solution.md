# Flatpak – riešenie

## Záver

**Problém**: Obsidian nainštalovaný ako Flatpak nedokáže spúšťať
hostiteľské binárky (`node`) zo sandboxu. Žiadne čisté riešenie
v rámci Flatpak neexistuje bez porušenia sandbox izolácie.

**Rozhodnutie**: Flatpak verziu nepodporujeme.

## Čo bolo implementované

Plugin detekuje Flatpak prostredie cez `existsSync('/.flatpak-info')`
a okamžite zobrazí chybu bez spúšťania daemona:

> "Tento plugin nepodporuje Obsidian nainštalovaný ako Flatpak.
> Nainštaluj verziu .deb alebo AppImage z obsidian.md/download."

## Čo bol dirty workaround (zrušený)

`flatpak-spawn --host` + `flatpak override --user --talk-name=org.freedesktop.Flatpak`
– fungoval, ale efektívne zrušil sandbox ochranu. Odstránené.

## Inštalácia pre usera

```bash
flatpak uninstall md.obsidian.Obsidian
flatpak override --user --reset md.obsidian.Obsidian
# stiahnuť .deb z obsidian.md/download
sudo dpkg -i obsidian-*.deb
```
