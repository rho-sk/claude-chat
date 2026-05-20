# Flatpak subprocess research – výsledky

## Ako to riešia ostatní

### obsidian-git, obsidian-shellcommands, obsidian-execute-code
**Odpoveď: nerieši sa.** Všetky tieto pluginy odporúčajú
nepoužívať Flatpak a prejsť na AppImage alebo .deb.
Maintainer obsidian-git: *"I think you have to create an issue on the Flatpak side."*

### VS Code Flatpak (com.visualstudio.code)
**Používa `flatpak-spawn --host`** – rovnaký mechanizmus ako my.
Kľúčový rozdiel: VS Code má `talk-name=org.freedesktop.Flatpak`
priamo v ich Flatpak **manifeste** (nie cez user override).
Terminál VS Code Flatpak predvolene beží ako:
```
/usr/bin/flatpak-spawn --host --env=TERM=xterm-256color bash
```

### Obsidian Flatpak manifest (čo je v ňom od výroby)
Z `md.obsidian.Obsidian.yml`:
- `--filesystem=home` ✓ (plný prístup k domovskému adresáru)
- `--share=network` ✓
- `--socket=ssh-auth` ✓
- `--talk-name=org.freedesktop.secrets` ✓ (keyring)
- `features=devel` ✗ **NIE JE**
- `talk-name=org.freedesktop.Flatpak` ✗ **NIE JE**

## Záver z výskumu

`flatpak-spawn --host` je **priemyselný štandard** pre Flatpak aplikácie
ktoré potrebujú spúšťať host procesy (VS Code, Theia, terminálové emulátoры).
Nie je to bezpečnostná diera – je to **navrhnutý únikový mechanizmus**.

Rozdiel medzi nami a VS Code:
- VS Code: povolenie je v manifeste → transparentné, reviewované Flathub tímom
- My: povolenie cez `flatpak override` → rovnaký efekt, menej transparentné

## Prehodnotenie security rizika

Obsidian Flatpak má od výroby `--filesystem=home`.
To znamená že akýkoľvek Obsidian plugin môže:
- čítať/zapisovať celý home (vrátane .ssh, .gnupg, všetko)
- modifikovať ~/.bashrc, ~/.profile, kradnúť kľúče, atď.

Čo `talk-name=org.freedesktop.Flatpak` pridáva navyše:
- spúšťanie príkazov MIMO sandboxu (napr. `/usr/bin` binárky)
- prístup k súborom mimo home (napr. `/etc`)
- `features=devel` (ptrace) – toto je reálne riziko navyše

## Čo s tým

### Možnosť A – zachovať current riešenie, odstrániť `features=devel`
`features=devel` nie je potrebné pre `flatpak-spawn --host`.
Stačí `talk-name=org.freedesktop.Flatpak`.
```bash
flatpak override --user --nofeatures=devel md.obsidian.Obsidian
```
Security profil: len o málo horší ako VS Code Flatpak.

### Možnosť B – požiadať Flathub aby pridali povolenie do manifestu
PR do https://github.com/flathub/md.obsidian.Obsidian
s `talk-name=org.freedesktop.Flatpak`.
Ak schvália → zero user setup, reviewované, transparentné.
Nevýhoda: dlhý proces, závislosť od tretej strany.

### Možnosť C – bundle node binary
Priložiť pre-kompilovanú node binárku (linux-x64, ~30 MB).
Spustiť ju priamo zo sandboxu.
Problém: môže zlyhať kvôli rôznym verziám glibc / knižniciam v sandboxe.
Navyše: `claude-agent-sdk` volá natívny `claude` binary ktorý tiež nie je v sandboxe.

### Možnosť D – čakať na Electron utilityProcess v Obsidiane
Electron 21+ má `utilityProcess` API pre forkovanie Node.js procesov
v main procese. Ak by Obsidian toto expozoval pluginom, bolo by to čisté.
Zatiaľ: Obsidian toto neexpozuje.

## Odporúčanie

**Krátkodobo**: odstrániť `features=devel`, zachovať `talk-name=org.freedesktop.Flatpak`.
**Dlhodobo**: PR do Flathub manifestu Obsidianu.

Toto je rovnaké čo robí VS Code Flatpak – legitímny prístup.
