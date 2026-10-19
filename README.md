<div align="center">

# 🎨 Mosaica Workspace Pro

**Strumento professionale per la creazione di mosaici, disegno a mano libera e tecniche ad acquerello digitali**

[![Versione](https://img.shields.io/github/v/release/picomosaici/mosaica-workspace-pro?label=versione&color=blue)](https://github.com/picomosaici/mosaica-workspace-pro/releases/latest)
[![Download totali](https://img.shields.io/github/downloads/picomosaici/mosaica-workspace-pro/total?label=download&color=green)](https://github.com/picomosaici/mosaica-workspace-pro/releases)
[![Licenza](https://img.shields.io/badge/licenza-Freeware%20%28gratuita%29-orange)](LICENSE.txt)
[![Build](https://img.shields.io/github/actions/workflow/status/picomosaici/mosaica-workspace-pro/build.yml?label=build)](https://github.com/picomosaici/mosaica-workspace-pro/actions)
[![Piattaforma](https://img.shields.io/badge/piattaforma-Windows-blue?logo=windows&logoColor=white)](https://github.com/picomosaici/mosaica-workspace-pro/releases)
[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Fabric.js](https://img.shields.io/badge/Fabric.js-5.5.2-red)](http://fabricjs.com/)

[Download](#-download-e-installazione) • 
[Funzionalità](#-funzionalità) • 
[Sviluppo](#-sviluppo) • 
[Licenza](#-licenza)

</div>

---

## 📖 Descrizione

**Mosaica Workspace Pro** è un'applicazione desktop pensata per artisti, mosaicisti professionisti e appassionati che desiderano progettare, disegnare ed esportare opere a tessere, disegni a mano libera e tecniche ad acquerello in formato digitale.

Sviluppata su tecnologia Electron e Fabric.js, offre un'esperienza nativa Windows con strumenti dedicati al mondo del mosaico (forme circolari, triangolari, trapezoidali, sagome personalizzate, texture di pietra generate da codice) e al disegno espressivo (pennelli a mano libera, stamp brush acquerello, supporto tavoletta Wacom), con strumenti di selezione pensati per lavorare tessera per tessera.

## ✨ Funzionalità

- 🟦 **Modelli geometrici dedicati al mosaico**: settori circolari, triangoli, trapezoidi, sagome personalizzate
- ✂️ **Builder forme non regolari** con foglio in mm reali (A5→A0 + personalizzato), arrotondamento per singolo vertice, curve di Bézier sui lati, immagine di riferimento per il ricalco e composizioni multi-forma (posa palladiana)
- 🪨 **Texture procedurali di pietra** generate da codice (granito, marmo, cemento, murano, EVA, venature): ripetibili senza giunte, colorabili a piacere e salvate nel progetto, così un file riaperto ritrova la texture identica anche su un altro PC
- 👻 **Texture fantasma** per i mosaici grandi: la texture si mette una volta su una tessera e si nasconde; copie, cambi di forma e settori se la portano dietro, e con un clic compare su tutta la famiglia, ogni tessera tinta col suo colore
- ✏️ **Penna a mano libera** vettoriale e sensibile alla pressione, con la punta tonda oppure con **punte PNG** (pennini, grafite, carboncino, gessetto…): distanza dei timbri, rotazione e punta che segue il tratto; le tue punte si aggiungono in una cartella
- 💧 **Stamp brush acquerello** per effetti pittorici realistici con *bleed*, con un set di punte fatte apposta (bordo bagnato, granulazione, spugna, schizzi…) e anello attorno al cursore misurato sulla punta vera
- 🖼️ **Pennello Timbro**: copi una zona del lavoro e la ristampi dove dipingi; punta con forma, misura, spaziatura e rotazione regolabili, anche con una forma libera disegnata col costruttore della palladiana
- 🚧 **Perimetro di contenimento**: tracci un poligono entro cui penna e acquerello possono colorare (e fuori no), comodo per restare dentro le fughe; si corregge con le maniglie, fa **curve** (punti morbidi e archi), ha una lente mirino con reticolo in mm, una **mira lenta** tenendo premuto e le frecce al centesimo di millimetro, e viene salvato col progetto
- 🎯 **Selezione avanzata delle tessere**:
  - **Lazo a poligono** per racchiudere un'area
  - **Pennello selezione**: selezioni le tessere "dipingendoci" sopra a mano libera, con larghezza in mm regolabile e tratti che si sommano (CTRL per deselezionare)
  - **Menu radiale** che agisce su una o più forme insieme (multi-selezione con CTRL+click): colore, texture, blocco, eliminazione, raggruppa / separa; quando non c'è spazio si dispone in colonna
  - **Comandi della selezione**: deseleziona, inquadra la selezione, specchio orizzontale e verticale (anche sulle tessere ruotate, senza cambiare le misure)
- 🎨 **Ruota dei colori** con HEX, RGB e **CMYK** del profilo di stampa, il colore «in stampa» accanto a quello «a video», l'avviso fuori stampa e il **contagocce**; vale per le tessere, la penna e l'acquerello
- 🖨️ **Prova di stampa** a video (soft-proof FOGRA39 / ISO Coated v2 300%, carta simulata, colori fuori stampa segnati) ed **Esporta per la stampa** in **PDF/X-4**, **PDF/X-1a** o PNG compatibile Adobe RGB; profili liberi nell'installer, gli originali ECI e Adobe si trovano da soli o si aggiungono
- 📏 **Sistema di calibrazione** dello schermo, per tessere in mm reali
- 🖌️ **Supporto tavoletta grafica Wacom** nativo
- 🖼️ **Canvas A4 verticale/orizzontale** con immagine di sfondo come riferimento (fit, rotazione, rimozione); l'orientamento si sceglie all'inizio e a lavoro iniziato il foglio non si gira
- 💾 **Salvataggio automatico** e gestione file di progetto
- 📤 **Esportazione SVG, PNG e PDF** ad alta qualità (il PNG con l'etichetta sRGB), con export dedicato delle sole linee a mano libera
- 🔪 **Tavola delle Tessere per il taglio laser**: SVG separati per famiglia di colore, compensazione del taglio e linguette, PDF per il banco di lavoro e distinta delle tessere in CSV
- 🔍 **Zoom Photoshop-style** fluido con snapshot GPU: gesti di rotella reattivi anche su canvas pesanti (centinaia di tessere, sfondi grandi, decine di tratti)
- 🖱️ **Mappatura mouse e tastiera completa**: tasti laterali X1/X2, combinazioni (chord), scorciatoie personalizzate, tasti direzionali rimappabili
- 🚀 **Accelerazione GPU** per progetti complessi
- 🌍 **Interfaccia multilingue** Italiano / Inglese con guida utente nella lingua dell'app
- 🔄 **Aggiornamenti automatici** da GitHub: controllo all'avvio e manuale (menu File → *Verifica aggiornamenti*), download con barra di avanzamento e verifica d'integrità **SHA-256**, installazione che preserva il lavoro tramite auto-salvataggio
- 🔒 **Sicurezza integrata**: app *offline-first* con Content-Security-Policy stretta, permessi di sistema negati e allowlist dei soli domini GitHub per gli aggiornamenti

## 📥 Download e installazione

Scarica l'ultima versione dalla pagina [**Releases**](https://github.com/picomosaici/mosaica-workspace-pro/releases/latest), esegui il file `MosaicaWorkspacePro-Setup-MM.YYYY.exe` e segui le istruzioni dell'installer.

> 💡 Al primo avvio Windows Defender potrebbe mostrare un avviso "Editore sconosciuto" (l'installer non è firmato con certificato digitale). Clicca su **Ulteriori informazioni → Esegui comunque**.

> 🔄 Una volta installata, Mosaica può avvisarti da sola quando esce una nuova versione: dal menu **File → Verifica aggiornamenti** scarichi e installi l'ultima release direttamente da GitHub, con verifica d'integrità SHA-256 e salvataggio automatico del lavoro prima del riavvio.

### Requisiti di sistema

- Windows 10 o 11 (64-bit)
- 4 GB di RAM (consigliati 8 GB)
- 500 MB di spazio su disco
- Scheda grafica con supporto WebGL (per accelerazione GPU)

## 🛠️ Sviluppo

Mosaica è un software proprietario: il codice è visibile pubblicamente ma il suo riutilizzo, modifica o ridistribuzione richiede autorizzazione esplicita (vedi [LICENSE.txt](LICENSE.txt)). Puoi comunque clonare il repository per studiare il codice o testare l'app in locale.

### Prerequisiti

- [Node.js 20+](https://nodejs.org/) (con npm incluso)
- Git

### Avvio in modalità sviluppo

```bash
git clone https://github.com/picomosaici/mosaica-workspace-pro.git
cd mosaica-workspace-pro
npm install
npm run dev
```

### Build dell'installer Windows

```bash
npm run dist
```

L'installer viene generato in `dist/MosaicaWorkspacePro-Setup-MM.YYYY.exe`.

### Le punte di acquerello e penna

Le punte «di fabbrica» (`app/textures/brush/` per l'acquerello, `app/textures/penna/` per la penna) sono generate da uno script, ripetibile:

```bash
pip install numpy pillow
python build/punte/genera_punte.py
```

## 🧰 Tecnologie

- [Electron](https://www.electronjs.org/) — framework desktop
- [Fabric.js](http://fabricjs.com/) (5.5.2) — canvas 2D
- [Little CMS](https://www.littlecms.com/) in WebAssembly ([lcms-wasm](https://github.com/mattdesl/lcms-wasm), licenza MIT) — motore colore per la prova di stampa e i PDF/X
- [PDFKit](https://pdfkit.org/) — esportazione PDF
- [electron-builder](https://www.electron.build/) — packaging Windows
- Profili di stampa nell'installer: basICColor ISO Coated v2 (licenza zlib) e un profilo compatibile Adobe RGB (1998) ([Compact-ICC-Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles), CC0); licenze nella cartella `profili-icc`

## 🐛 Segnalazione bug e suggerimenti

Hai trovato un bug o vuoi proporre una funzionalità? Apri una [Issue](https://github.com/picomosaici/mosaica-workspace-pro/issues/new) descrivendo:

- Cosa stavi facendo quando si è verificato il problema
- Cosa ti aspettavi
- Cosa è successo invece
- Versione di Mosaica (visibile nella guida utente)
- Versione di Windows

## 📄 Licenza

**Mosaica Workspace Pro** è distribuito come **freeware proprietario**: gratuito per uso personale e professionale, con codice protetto da copyright.

Vedi il file [LICENSE.txt](LICENSE.txt) per i dettagli completi.

## 📬 Contatti

**Pico Mosaici**  
📧 picomosaici@gmail.com

---

<div align="center">

Made with ❤️ in Italy

</div>