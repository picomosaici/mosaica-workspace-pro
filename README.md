<div align="center">

# 🎨 Mosaica Workspace Pro

**Strumento professionale per la creazione di mosaici, disegno a mano libera e tecniche ad acquerello digitali**

[![Versione](https://img.shields.io/github/v/release/picomosaici/mosaica-workspace-pro?label=versione&color=blue)](https://github.com/picomosaici/mosaica-workspace-pro/releases/latest)
[![Download totali](https://img.shields.io/github/downloads/picomosaici/mosaica-workspace-pro/total?label=download&color=green)](https://github.com/picomosaici/mosaica-workspace-pro/releases)
[![Licenza](https://img.shields.io/badge/licenza-Freeware%20%28gratuita%29-orange)](LICENSE.txt)
[![Build](https://img.shields.io/github/actions/workflow/status/picomosaici/mosaica-workspace-pro/build.yml?label=build)](https://github.com/picomosaici/mosaica-workspace-pro/actions)
[![Piattaforma](https://img.shields.io/badge/piattaforma-Windows-blue?logo=windows&logoColor=white)](https://github.com/picomosaici/mosaica-workspace-pro/releases)
[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Fabric.js](https://img.shields.io/badge/Fabric.js-5.1.0%2B-red)](http://fabricjs.com/)

[Download](#-download-e-installazione) • 
[Funzionalità](#-funzionalità) • 
[Sviluppo](#-sviluppo) • 
[Licenza](#-licenza)

</div>

---

## 📖 Descrizione

**Mosaica Workspace Pro** è un'applicazione desktop pensata per artisti, mosaicisti professionisti e appassionati che desiderano progettare, disegnare ed esportare opere a tessere, disegni a mano libera e tecniche ad acquerello in formato digitale.

Sviluppata su tecnologia Electron e Fabric.js, offre un'esperienza nativa Windows con strumenti dedicati al mondo del mosaico (forme circolari, triangolari, trapezoidali, sagome custom) e al disegno espressivo (pennelli a mano libera, stamp brush acquerello, supporto tavoletta Wacom).

## ✨ Funzionalità

- 🟦 **Modelli geometrici dedicati al mosaico**: settori circolari, triangoli, trapezoidi, sagome personalizzate
- ✂️ **Builder forme non regolari** con foglio in mm reali (A5→A0 + personalizzato), arrotondamento per singolo vertice, curve di Bézier sui lati, immagine di riferimento per il ricalco e composizioni multi-forma (posa palladiana)
- ✏️ **Disegno a mano libera** con pennelli pressure-sensitive
- 💧 **Stamp brush acquerello** per effetti pittorici realistici
- 🎨 **Sistema di calibrazione** colore e dimensione tessere
- 📐 **Selezione lazo** e strumenti di selezione avanzati
- 🖌️ **Supporto tavoletta grafica Wacom** nativo
- 💾 **Salvataggio automatico** e gestione file di progetto
- 📤 **Esportazione SVG** e PDF ad alta qualità
- 🔍 **Zoom Photoshop-style** fluido con snapshot GPU: gesti di rotella reattivi anche su canvas pesanti (centinaia di tessere, sfondi grandi, decine di tratti)
- 🖱️ **Mappatura mouse e tastiera completa**: tasti laterali X1/X2, combinazioni (chord), scorciatoie personalizzate, tasti direzionali rimappabili
- ⌨️ **Scorciatoie da tastiera** personalizzabili
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

## 🧰 Tecnologie

- [Electron](https://www.electronjs.org/) — framework desktop
- [Fabric.js](http://fabricjs.com/) (5.1.0+) — canvas 2D
- [PDFKit](https://pdfkit.org/) — esportazione PDF
- [electron-builder](https://www.electron.build/) — packaging Windows

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