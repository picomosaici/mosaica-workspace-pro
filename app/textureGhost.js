// ============================================================
//  textureGhost.js — Mosaica Workspace Pro
//  LE TEXTURE FANTASMA (cantiere «Texture Ghost»: Fetta 1 il motore,
//  Fetta 2 l'interfaccia — ispettore e popover ▦ — e B12)
// ------------------------------------------------------------
//  COS'È
//  -----
//  Una texture che una tessera si porta dietro anche quando non si
//  vede. Si mette la texture su una tessera (la «capostipite»), le si
//  danno grana e colore, poi la si fa FANTASMA: la tessera torna al
//  colore che aveva prima della texture, e da quel momento ogni
//  tessera che nasce da lei (copie, copie delle copie, cambio di
//  forma, cerchio diviso) entra nella sua FAMIGLIA. Si lavora coi
//  colori; quando si vuole, «Mostra» rimette la grana su tutte le
//  tessere della famiglia in un colpo, «Nascondi» la toglie.
//
//  Il segno sta su ogni tessera, nel campo `__ghost`, e dice TUTTO
//  quello che serve (non è un rimando alla capostipite: se la si
//  cancella, la famiglia vive):
//     f  la famiglia (un nome suo: customId non va, trappola 266)
//     t  l'immagine (l'id del registro delle texture di renderer.js)
//     g  la grana in mm
//     c  1 = «colora dalla ruota» acceso sulla capostipite
//     k  la tinta della capostipite (solo per mostrarla)
//     v  1 = famiglia mostrata, 0 = nascosta
//     b  il colore proprio della tessera, SOLO mentre mostra la
//        texture della famiglia (è il colore a cui torna)
//  Con «colora» acceso ogni tessera prende la grana tinta col SUO
//  colore (B1 = a): la famiglia dà la grana, il colore resta suo.
//
//  PERCHÉ STA FUORI DA renderer.js — il patto
//  ------------------------------------------
//  renderer.js, keyboardShortcuts.js, mouseObserver.js e svgExport.js
//  non si toccano. Tutto passa da PORTE (vedi selectionTools.js per le
//  due regole dei nomi presi in prestito):
//
//   (a) LA PORTA DI FABRIC. Per Fabric copiare una tessera vuol dire
//       SCRIVERLA (toObject) e RILEGGERLA (fromObject), e passano da
//       toObject anche l'annulla, il salvataggio e l'autosalvataggio.
//       Avvolgendo `fabric.Object.prototype.toObject` (UNA volta sola)
//       il segno passa dappertutto senza toccare le liste dei campi,
//       che stanno in file protetti e sono diverse fra loro (trappola
//       267). `callSuper` di Fabric rilegge il metodo del prototipo a
//       ogni chiamata: i toObject di Rect, Polygon, Path… passano da
//       qui. Provato su Fabric 5.1.0, 5.2.4, 5.3.0 e 5.5.2.
//   (b) FUNZIONI DI renderer.js SU window: `collectTextureRegistry`,
//       `radialChangeShapeAction`, `sliceCircleAction`. Sono function
//       di primo livello di uno script classico: renderer.js e
//       autoSave.js le chiamano per nome, e il nome È la proprietà di
//       window. Avvolgerle qui le prende anche da là.
//   (c) ASCOLTATORI: `object:added` del canvas (le copie e le tessere
//       nate da cambio forma / dividi) e un `change` IN CATTURA su
//       document per la ruota colore (arriva prima di renderer.js).
//
//  E DUE RIPARAZIONI DEL SISTEMA DI BASE (decise da Mirko, B4 e B5)
//  ---------------------------------------------------------------
//   B4  La copia di una tessera con texture NON colorata porta la
//       texture e la grana (prima usciva grigia #cfcfd0, T1). Con la
//       texture colorata dalla ruota tutto come prima: la copia ha la
//       tinta piena.
//   B5  T2 — la ruota colore su una texture non colorata lascia le
//       etichette `__texture*` sulla tessera e la texture «risorge» al
//       primo Ctrl+Z o alla riapertura: le etichette si tolgono PRIMA
//       che renderer.js faccia lo stato dell'annulla.
//       T3 — cambia forma (e dividi il cerchio) danno alla tessera nuova
//       il motivo ma non le etichette: un Ctrl+Z la perdeva. Le
//       etichette si copiano dalla tessera di partenza; e in ogni
//       scrittura con la lista delle etichette, una tessera col motivo
//       e senza etichette le prende dal motivo (cintura in più).
//   B11 Un clic sul ◔ chiama sliceCircleAction DUE volte (T8): la
//       seconda, a vuoto, dava «❌ Seleziona prima un cerchio…» subito
//       dopo «✅ Diviso». La seconda chiamata dello stesso clic si
//       ignora.
//   B12 Il colore di prima della texture (`__preTextureFill`) non stava
//       in nessuna lista dell'annulla e del file: dopo una riapertura
//       «👻 Fantasma» e «Togli da tutte» non lo ritrovavano. La porta di
//       Fabric lo scrive sulle tessere CON texture, nelle scritture con
//       la lista delle etichette (annulla, file, autosalvataggio).
//
//  L'INTERFACCIA (Fetta 2)
//  -----------------------
//   • Ispettore, blocco «👻 Texture fantasma» (#inspectorGhostBlock,
//     sotto il blocco Texture): «👻 Fantasma» su una tessera con texture;
//     su una tessera di una famiglia il nome (immagine, grana, tessere)
//     e «Mostra / Nascondi la famiglia». Si aggiorna da
//     `updateTextureGrainPanel` di renderer.js, avvolta (porta b): la
//     chiamano già la selezione, lo spostamento e gli annulla.
//   • Popover ▦, sezione «👻 Texture fantasma»: una riga per famiglia
//     (miniatura, nome, tessere, Mostra/Nascondi) e «Mostra tutte /
//     Nascondi tutte». Si rifà quando il popover si apre (un osservatore
//     sul suo aria-hidden: renderer.js non si tocca).
//   • Gli avvisi li mette l'interfaccia; i comandi di window.textureGhost
//     restano muti (si usano anche dalle prove).
//
//  ⚠ LE REGOLE CHE NON SI ROMPONO
//   • Lo stato vero è sulla tessera (trappola 270): una tessera mostra
//     la famiglia se il suo fill È il motivo della famiglia, non perché
//     un flag lo dice.
//   • Mai ripulire etichette «alla cieca» dentro toObject: dopo un
//     annulla o un'apertura le tessere hanno per un attimo il colore
//     segnaposto E le etichette, ed è giusto (trappola 270).
//   • Una famiglia nascosta NON ha etichette `__texture*` sulle tessere:
//     così l'annulla e la riapertura non possono rimetterla da sole.
//   • Un settore del cerchio, alla riapertura del file, viene RIFATTO da
//     zero da renderer.js con una lista fissa di campi (T5, trappola
//     268): il segno di un settore viaggia anche dentro `__shape`.
//   • Senza `__ghost` e senza texture l'oggetto scritto è identico al
//     carattere a quello di prima.
//
//  I 1 600 (Fetta 3)
//  -----------------
//   • La memoria delle tinte che non dimentica quello che si vede: una tinta
//     resta pronta finché una tessera del foglio la usa (porta b su
//     _getColorizedSource). Ctrl+Z, Ctrl+Y e l'incolla non ricalcolano più
//     le tinte di una famiglia mostrata (trappola 271).
//     Anche la riapertura del file calcola ogni tinta una volta sola.
//   • Il pulsante Mostra: sopra il mezzo secondo (a stima) prima l'avviso
//     «⏳», poi il lavoro.
//
//  Fabric: 5.5.2 in uso; 5.1.0 → 5.5.2 supportate. Solo API presenti
//  in tutte (toObject, fill, Pattern, eventi del canvas).
// ============================================================
(function () {
  "use strict";

  if (window.__textureGhostInstalled) return;
  if (typeof fabric === "undefined" || !fabric.Object || !fabric.Object.prototype) return;
  if (typeof canvas === "undefined" || !canvas || typeof canvas.on !== "function") return;
  window.__textureGhostInstalled = true;

  const TG_VERSION = "3";
  const LABELS = ["__textureId", "__textureSpanMM", "__textureColorize", "__textureTint", "__preTextureFill"];

  // ── nomi presi in prestito da renderer.js (sempre con la guardia) ──
  function busy() {
    try {
      if (typeof isApplyingSnapshot !== "undefined" && isApplyingSnapshot) return true;
    } catch (_) {}
    try {
      if (typeof isRestoringProject !== "undefined" && isRestoringProject) return true;
    } catch (_) {}
    return false;
  }
  function hexOf(c) {
    try {
      if (typeof toHex === "function") return String(toHex(c)).toLowerCase();
    } catch (_) {}
    return String(c || "").toLowerCase();
  }
  function registryEntry(id) {
    try {
      return typeof getRegisteredTexture === "function" ? getRegisteredTexture(id) : null;
    } catch (_) {
      return null;
    }
  }
  function rebuild(o, done) {
    try {
      if (typeof rebuildTextureFill === "function") return rebuildTextureFill(o, done);
    } catch (e) {
      console.warn("[textureGhost] rebuild", e);
    }
    if (done) done(false);
  }
  function push() {
    try {
      if (typeof pushState === "function" && !busy()) pushState();
    } catch (_) {}
  }
  function refreshPanel() {
    try {
      if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();
    } catch (_) {}
  }

  // ── piccole cose ──
  function hasPat(o) {
    const f = o && o.fill;
    return !!(f && typeof f === "object" && f.__texId);
  }
  // La tessera MOSTRA la texture della famiglia: ha il colore proprio
  // annotato (b) e il suo fill è davvero il motivo di quell'immagine.
  function showsFamily(o) {
    const g = o && o.__ghost;
    return !!(g && g.b != null && hasPat(o) && o.fill.__texId === g.t);
  }
  function cloneGhost(g) {
    try {
      return JSON.parse(JSON.stringify(g));
    } catch (_) {
      return null;
    }
  }
  function stripLabels(o) {
    for (let i = 0; i < LABELS.length; i++) delete o[LABELS[i]];
  }
  function leaves(list, out) {
    out = out || [];
    (list || []).forEach((o) => {
      if (!o) return;
      if ((o.type === "group" || o.type === "activeSelection") && Array.isArray(o._objects)) leaves(o._objects, out);
      else out.push(o);
    });
    return out;
  }
  function allLeaves() {
    return leaves(canvas.getObjects());
  }
  function markDirty(o) {
    o.dirty = true;
    if (o.group) o.group.dirty = true;
  }
  function newFamilyId() {
    const used = new Set();
    allLeaves().forEach((o) => {
      if (o.__ghost && o.__ghost.f) used.add(o.__ghost.f);
    });
    let id;
    do {
      id = "g" + Math.random().toString(36).slice(2, 9);
    } while (used.has(id) || id.length < 8);
    return id;
  }
  // Il colore che la tessera mostra quando la texture della famiglia è a
  // posto: con «colora» acceso è la tinta (se l'hanno ritinta con la ruota
  // vale la tinta nuova), altrimenti il colore proprio annotato.
  function ownColorWhileShown(o) {
    const g = o.__ghost;
    if (o.__textureColorize && o.__textureTint && g && g.b != null && hexOf(o.__textureTint) !== hexOf(g.b)) {
      return o.__textureTint;
    }
    return g && g.b != null ? g.b : o.__textureTint || "#cfcfd0";
  }

  // ════════════════════════════════════════════════════════════════
  //  (a) LA PORTA DI FABRIC
  // ════════════════════════════════════════════════════════════════
  const protoTo = fabric.Object.prototype.toObject;
  if (!protoTo.__tgWrapped) {
    const wrapped = function (propertiesToInclude) {
      const o = protoTo.call(this, propertiesToInclude);
      try {
        portWrite(this, o, propertiesToInclude);
      } catch (e) {
        console.warn("[textureGhost] toObject", e);
      }
      return o;
    };
    wrapped.__tgWrapped = true;
    wrapped.__tgOriginal = protoTo;
    fabric.Object.prototype.toObject = wrapped;
  }

  function portWrite(src, o, list) {
    const g = src.__ghost;
    const f = src.fill;
    const pat = !!(f && typeof f === "object" && f.__texId);
    const withLabels = Array.isArray(list) && list.indexOf("__textureId") >= 0;

    // Il segno: sempre una COPIA, mai lo stesso oggetto.
    if (g && typeof g === "object") o.__ghost = cloneGhost(g);

    // Settore del cerchio: il segno anche dentro __shape (T5). Si scrive
    // su una copia di __shape, non su quello della tessera viva.
    if (o.__shape && typeof o.__shape === "object" && src.__shapeType === "sector") {
      if (g) o.__shape = Object.assign({}, o.__shape, { __tgGhost: cloneGhost(g) });
      else if (o.__shape.__tgGhost) {
        const s = Object.assign({}, o.__shape);
        delete s.__tgGhost;
        o.__shape = s;
      }
    }

    if (withLabels) {
      // Annulla, file, autosalvataggio. T3: una tessera col motivo e senza
      // etichette le scrive prese dal motivo (come già fanno da sé il
      // salvataggio manuale e l'autosalvataggio). Non si toglie MAI niente.
      if (pat && !src.__textureId) {
        o.__textureId = f.__texId;
        if (f.__spanMM != null) o.__textureSpanMM = f.__spanMM;
        o.__textureColorize = !!f.__colorize;
        if (f.__colorize && f.__tint) o.__textureTint = f.__tint;
      }
      // B12: il colore di prima della texture viaggia con la tessera, ma
      // SOLO se la tessera ha una texture (una famiglia nascosta non ha
      // etichette, e non deve averne: trappola 270).
      if (
        (pat || src.__textureId) &&
        typeof src.__preTextureFill === "string" &&
        src.__preTextureFill &&
        o.__preTextureFill === undefined
      ) {
        o.__preTextureFill = src.__preTextureFill;
      }
      return;
    }

    // Una scrittura SENZA la lista delle etichette è una copia (Ctrl+C/V,
    // ⎘, Duplica selezione) o un export che rimette la texture da sé. Il
    // segnale __tgCopy dice all'ascoltatore di object:added che questa
    // tessera è appena nata da un'altra e va sistemata quando entra.
    if (src.__tgCopy) {
      // Una copia che non è ancora entrata nel foglio (gli appunti del
      // Ctrl+C) e viene copiata di nuovo: porta avanti quello che aveva.
      o.__tgCopy = 1;
      if (src.__textureId) {
        o.__textureId = src.__textureId;
        if (src.__textureSpanMM != null) o.__textureSpanMM = src.__textureSpanMM;
        if (typeof src.__preTextureFill === "string") o.__preTextureFill = src.__preTextureFill;
      }
      return;
    }
    if (pat) {
      if (g && showsFamily(src)) {
        // Mostra la famiglia: la copia nasce col colore PROPRIO (§5.4.3);
        // se la famiglia è ancora mostrata quando entra, la grana gliela
        // rimette l'ascoltatore.
        o.fill = ownColorWhileShown(src);
        o.__tgCopy = 1;
      } else if (!f.__colorize) {
        // B4: texture NON colorata → la copia porta immagine e grana.
        o.__textureId = f.__texId;
        if (f.__spanMM != null) o.__textureSpanMM = f.__spanMM;
        if (typeof src.__preTextureFill === "string") o.__preTextureFill = src.__preTextureFill;
        o.__tgCopy = 1;
      } else if (g) {
        o.__tgCopy = 1;
      }
      return;
    }
    if (g) o.__tgCopy = 1;
  }

  // ════════════════════════════════════════════════════════════════
  //  STATO DELLE FAMIGLIE
  // ════════════════════════════════════════════════════════════════
  // f → { shown: c'è almeno una tessera che la mostra davvero }.
  // Si calcola una volta per giro (una paste di 1 600 tessere non lo
  // rifà 1 600 volte) e si butta al giro dopo o quando un comando cambia
  // le cose.
  let _famCache = null;
  function famState() {
    if (_famCache) return _famCache;
    const m = new Map();
    allLeaves().forEach((o) => {
      const g = o.__ghost;
      if (!g || !g.f || o.__tgCopy) return;
      let e = m.get(g.f);
      if (!e) m.set(g.f, (e = { shown: false }));
      if (!e.shown && showsFamily(o)) e.shown = true;
    });
    _famCache = m;
    setTimeout(() => {
      _famCache = null;
    }, 0);
    return m;
  }
  function dropFamCache() {
    _famCache = null;
  }

  // Mette la texture della famiglia su UNA tessera (l'immagine è già in
  // registro: rebuildTextureFill è sincrona). Ritorna true se l'ha messa.
  function showOne(o) {
    const g = o.__ghost;
    if (!g) return false;
    const own =
      typeof o.fill === "string" ? o.fill : g.b != null ? g.b : typeof o.__preTextureFill === "string" ? o.__preTextureFill : "#cfcfd0";
    g.b = own;
    g.v = 1;
    o.__preTextureFill = own;
    o.__textureId = g.t;
    o.__textureSpanMM = g.g;
    o.__textureColorize = !!g.c;
    o.__textureTint = g.c ? hexOf(own) : null;
    let ok = false;
    rebuild(o, (r) => {
      ok = !!r;
    });
    markDirty(o);
    return ok;
  }

  // Toglie la texture della famiglia da UNA tessera, se ce l'ha.
  function hideOne(o) {
    const g = o.__ghost;
    if (!g) return false;
    let changed = false;
    if (showsFamily(o)) {
      o.set("fill", ownColorWhileShown(o));
      stripLabels(o);
      markDirty(o);
      changed = true;
    }
    delete g.b;
    g.v = 0;
    return changed;
  }

  // ════════════════════════════════════════════════════════════════
  //  (c) LE TESSERE CHE ENTRANO NEL FOGLIO
  // ════════════════════════════════════════════════════════════════
  let _inherit = null; // { ghost, labels, pat } durante cambia forma / dividi

  function normalizeSector(o) {
    // T5: un settore rifatto all'apertura ha il segno solo dentro __shape.
    // ⚠ Non si cancella __shape.__tgGhost: l'oggetto letto e il settore
    // rifatto da renderer.js condividono lo STESSO __shape.
    const s = o.__shape;
    if (s && typeof s === "object" && s.__tgGhost && !o.__ghost) o.__ghost = cloneGhost(s.__tgGhost);
  }

  function handleCopy(o) {
    // Lo stato delle famiglie si legge PRIMA di togliere il segnale: la
    // copia non deve contare se stessa. Con un Taglia (Ctrl+X) la famiglia
    // può non avere più nessuna tessera sul foglio: vale allora quello che
    // la copia si è portata dietro (v).
    const states = famState();
    delete o.__tgCopy;
    // B4 (e la texture «sua» di una tessera fantasma): la copia ha
    // l'immagine e la grana ma il colore segnaposto → si rifà il motivo.
    if (o.__textureId && !hasPat(o)) rebuild(o);
    const g = o.__ghost;
    if (!g || !g.f) return;
    const st = states.get(g.f);
    const shown = st ? st.shown : g.v === 1;
    if (shown) {
      if (hasPat(o) && !showsFamily(o)) {
        // Ha una texture sua (B7): resta la sua.
        delete g.b;
        g.v = 1;
      } else if (!showsFamily(o)) {
        const e = registryEntry(g.t);
        if (e && e.img) showOne(o);
        else if (e && typeof ensureRegisteredImage === "function") {
          g.v = 1;
          ensureRegisteredImage(g.t, (img) => {
            if (img && o.__ghost && o.canvas) {
              showOne(o);
              canvas.requestRenderAll();
            }
          });
        }
      }
    } else {
      // Famiglia nascosta: la copia ha già il colore proprio.
      g.v = 0;
      delete g.b;
    }
  }

  function applyInherit(o, src) {
    if (src.ghost && !o.__ghost) o.__ghost = cloneGhost(src.ghost);
    // T3 / T3-bis: il motivo c'è, le etichette no → dalla tessera di
    // partenza (o dal motivo stesso), e un motivo SUO (i quattro settori
    // avevano lo stesso oggetto Pattern: la grana di uno cambiava tutti).
    if (hasPat(o) && !o.__textureId) {
      const L = src.labels;
      if (L.__textureId) {
        LABELS.forEach((k) => {
          if (L[k] !== undefined) o[k] = L[k];
        });
      } else {
        const p = o.fill;
        o.__textureId = p.__texId;
        o.__textureSpanMM = p.__spanMM;
        o.__textureColorize = !!p.__colorize;
        o.__textureTint = p.__colorize ? p.__tint : null;
      }
      rebuild(o);
      markDirty(o);
    }
  }

  function processAdded(o, inGroup) {
    if (!o) return;
    if ((o.type === "group" || o.type === "activeSelection") && Array.isArray(o._objects)) {
      o._objects.forEach((c) => processAdded(c, true));
      if (inGroup !== true) o.dirty = true;
      return;
    }
    normalizeSector(o);
    if (busy()) {
      // Annulla e apertura: le tessere tornano come erano scritte, non
      // sono copie. (Un segnale rimasto da un salvataggio senza lista non
      // deve far niente qui.)
      delete o.__tgCopy;
      return;
    }
    if (o.__tgCopy) handleCopy(o);
    if (_inherit) applyInherit(o, _inherit);
  }

  canvas.on("object:added", (e) => {
    try {
      processAdded(e && e.target);
    } catch (err) {
      console.warn("[textureGhost] object:added", err);
    }
  });

  function snapshotSource(a) {
    if (!a || a.type === "activeSelection" || a.type === "group") return null;
    const labels = {};
    LABELS.forEach((k) => {
      if (a[k] !== undefined && a[k] !== null) labels[k] = a[k];
    });
    return { ghost: a.__ghost ? cloneGhost(a.__ghost) : null, labels: labels };
  }

  // ════════════════════════════════════════════════════════════════
  //  (b) LE FUNZIONI DI renderer.js
  // ════════════════════════════════════════════════════════════════
  // collectTextureRegistry: nel file vanno anche le immagini delle
  // famiglie NASCOSTE (nessuna tessera le usa a vista, ma tutte le sanno).
  if (typeof window.collectTextureRegistry === "function" && !window.collectTextureRegistry.__tgWrapped) {
    const origCollect = window.collectTextureRegistry;
    const w = function (objects) {
      const out = origCollect.apply(this, arguments) || {};
      try {
        leaves(objects || []).forEach((o) => {
          const g = o && o.__ghost;
          if (!g || !g.t || out[g.t]) return;
          const e = registryEntry(g.t);
          if (e && e.dataURL) out[g.t] = e.dataURL;
        });
      } catch (err) {
        console.warn("[textureGhost] collectTextureRegistry", err);
      }
      return out;
    };
    w.__tgWrapped = true;
    window.collectTextureRegistry = w;
  }

  // ════════════════════════════════════════════════════════════════
  //  I 1 600 (Fetta 3): LA MEMORIA DELLE TINTE CHE NON DIMENTICA
  //  QUELLO CHE SI VEDE
  // ════════════════════════════════════════════════════════════════
  // Con «colora» acceso ogni tessera ha la grana tinta col SUO colore (B1):
  // una famiglia mostrata di 1 600 tessere usa decine o centinaia di tinte.
  // renderer.js ricorda solo le ultime 48 (_TEX_RECOLOR_CACHE_MAX), e dopo
  // un Ctrl+Z o un Ctrl+Y rifà la texture tessera per tessera nell'ordine
  // del foglio: oltre le 48 la memoria gira a vuoto e ogni tinta si
  // ricalcola da capo (trappola 271). Sul banco: 4 s a ogni Ctrl+Z.
  //
  // La porta (b): _getColorizedSource, una function di primo livello che
  // buildTexturePattern chiama per nome. Qui sopra si mette una seconda
  // memoria che tiene una tinta finché una tessera del foglio la USA: la
  // sua immagine è già viva (è la sorgente del motivo di quella tessera),
  // quindi tenerla costa zero memoria in più. Quando nessuna tessera la usa
  // più (famiglia nascosta, texture tolta) la si lascia andare, a riposo.
  // ⚠ L'immagine restituita è la stessa che renderer.js calcolerebbe: stessa
  // immagine neutra (stesso id), stessa tinta → stessi pixel.
  // ⚠ Vale anche per le texture colorate normali (non fantasma): è solo
  // più veloce, il disegno non cambia.
  const TINT_PRUNE_MS = 2500; // a riposo da quanto, prima di guardare quali tinte non servono più
  const _tintKeep = new Map(); // "id|#tinta" → la sorgente ricolorata
  const _tintStat = { hits: 0, misses: 0, computed: 0 };
  const _msPerPx = new Map(); // id → millisecondi per pixel di una ricolorazione (misurati)
  const MS_PER_PX_GUESS = 6e-5; // finché non si è misurato: 10 ms per un'immagine da 354×501 (banco)
  let _pruneTimer = 0;

  function tintKey(id, tint) {
    return id + "|" + String(tint).toLowerCase();
  }
  function schedulePrune() {
    if (_pruneTimer) clearTimeout(_pruneTimer);
    _pruneTimer = setTimeout(pruneTints, TINT_PRUNE_MS);
  }
  // Via le tinte che nessuna tessera del foglio usa più.
  function pruneTints() {
    _pruneTimer = 0;
    if (!_tintKeep.size) return;
    if (busy()) {
      schedulePrune();
      return;
    }
    const live = new Set();
    allLeaves().forEach((o) => {
      const f = o.fill;
      if (f && typeof f === "object" && f.__texId && f.source) live.add(f.source);
    });
    _tintKeep.forEach((c, k) => {
      if (!live.has(c)) _tintKeep.delete(k);
    });
  }
  function imgPixels(img) {
    if (!img) return 0;
    return (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
  }
  // Quanto costa una ricolorazione dell'immagine id (ms), dalla misura vera
  // se c'è.
  function recolorMs(id) {
    const e = registryEntry(id);
    const px = imgPixels(e && e.img) || 512 * 512;
    const k = _msPerPx.get(id);
    return px * (k != null ? k : MS_PER_PX_GUESS);
  }

  if (typeof window._getColorizedSource === "function" && !window._getColorizedSource.__tgWrapped) {
    const origColorized = window._getColorizedSource;
    const w = function (id, neutralImg, colorize, tint) {
      if (!colorize || !tint || !neutralImg) return origColorized.apply(this, arguments);
      const key = tintKey(id, tint);
      const kept = _tintKeep.get(key);
      if (kept) {
        _tintStat.hits++;
        return kept;
      }
      _tintStat.misses++;
      const t0 = performance.now();
      const c = origColorized.apply(this, arguments);
      const dt = performance.now() - t0;
      if (dt > 1) {
        // una ricolorazione vera (non la memoria di renderer.js): si impara quanto costa
        _tintStat.computed++;
        const px = imgPixels(neutralImg);
        if (px > 0) {
          const k = dt / px, old = _msPerPx.get(id);
          _msPerPx.set(id, old == null ? k : old * 0.7 + k * 0.3);
        }
      }
      if (c && c !== neutralImg) {
        _tintKeep.set(key, c);
        schedulePrune();
      }
      return c;
    };
    w.__tgWrapped = true;
    w.__tgOriginal = origColorized;
    window._getColorizedSource = w;
  }

  // Quanto costerà mostrare le famiglie fs (ms, a occhio): le tinte che non
  // sono già in memoria per il costo di una ricolorazione, più poco per
  // tessera. Serve all'avviso «⏳» (sopra il mezzo secondo).
  function estimateShow(fs) {
    const wanted = new Set(fs);
    const keys = new Set();
    let n = 0;
    allLeaves().forEach((o) => {
      const g = o.__ghost;
      if (!g || !wanted.has(g.f) || showsFamily(o) || hasPat(o)) return;
      n++;
      if (!g.c) return;
      const own = typeof o.fill === "string" ? o.fill : g.b != null ? g.b : o.__preTextureFill;
      if (typeof own !== "string") return;
      const k = tintKey(g.t, hexOf(own));
      if (!_tintKeep.has(k)) keys.add(k);
    });
    let ms = n * 0.05;
    keys.forEach((k) => {
      ms += recolorMs(k.slice(0, k.indexOf("|")));
    });
    return { ms: Math.round(ms), tints: keys.size, tiles: n };
  }

  // Cambia forma 🔄: la tessera nuova è «nata da» quella vecchia.
  if (typeof window.radialChangeShapeAction === "function" && !window.radialChangeShapeAction.__tgWrapped) {
    const origChange = window.radialChangeShapeAction;
    const w = function () {
      const src = snapshotSource(canvas.getActiveObject());
      const prev = _inherit;
      _inherit = src;
      try {
        return origChange.apply(this, arguments);
      } finally {
        _inherit = prev;
      }
    };
    w.__tgWrapped = true;
    window.radialChangeShapeAction = w;
  }

  // Dividi il cerchio ◔: i settori sono «nati da» il cerchio. B11: la
  // seconda chiamata dello stesso clic (T8) non deve dire niente.
  if (typeof window.sliceCircleAction === "function" && !window.sliceCircleAction.__tgWrapped) {
    const origSlice = window.sliceCircleAction;
    let justSliced = false;
    const w = function () {
      const a = canvas.getActiveObject();
      const isRound = !!(a && (a.type === "circle" || a.type === "ellipse"));
      if (!isRound && justSliced) return;
      const src = isRound ? snapshotSource(a) : null;
      const prev = _inherit;
      _inherit = src;
      try {
        return origSlice.apply(this, arguments);
      } finally {
        _inherit = prev;
        if (isRound && !canvas.getObjects().includes(a)) {
          justSliced = true;
          setTimeout(() => {
            justSliced = false;
          }, 0);
        }
      }
    };
    w.__tgWrapped = true;
    window.sliceCircleAction = w;
  }

  // ════════════════════════════════════════════════════════════════
  //  B5 / T2 — LA RUOTA COLORE (in cattura, prima di renderer.js)
  // ════════════════════════════════════════════════════════════════
  document.addEventListener(
    "change",
    (e) => {
      if (!e.target || e.target.id !== "colorInput") return;
      try {
        const a = canvas.getActiveObject();
        if (!a) return;
        leaves([a]).forEach((o) => {
          // Texture NON colorata: la ruota la sostituisce con un colore
          // pieno; le etichette devono andarsene con lei, prima dello
          // stato dell'annulla. (Colorata: la ruota la tinge, si lascia.)
          // ⚠ Non si guarda se il fill è ancora il motivo: l'anteprima dal
          // vivo (l'«input», prima del «change») ha già messo il colore.
          if (o.__textureId && !o.__textureColorize) {
            const g = o.__ghost;
            if (g && g.b != null && o.__textureId === g.t) delete g.b;
            stripLabels(o);
          }
        });
        dropFamCache();
        // L'ispettore va rifatto quando renderer.js ha finito il suo giro.
        setTimeout(updateGhostUI, 0);
      } catch (err) {
        console.warn("[textureGhost] colorInput", err);
      }
    },
    true
  );

  // ════════════════════════════════════════════════════════════════
  //  I COMANDI
  // ════════════════════════════════════════════════════════════════
  function selectedLeaves() {
    const a = canvas.getActiveObject();
    return a ? leaves([a]) : [];
  }
  function familyIdOf(x) {
    if (!x) return null;
    if (typeof x === "string") return x;
    return x.__ghost && x.__ghost.f ? x.__ghost.f : null;
  }
  function membersOf(f) {
    return allLeaves().filter((o) => o.__ghost && o.__ghost.f === f);
  }

  // Il colore che la tessera aveva prima della texture.
  function colorBeforeTexture(o) {
    if (o.__ghost && o.__ghost.b != null && showsFamily(o)) return o.__ghost.b;
    if (typeof o.__preTextureFill === "string" && o.__preTextureFill) return o.__preTextureFill;
    if (o.__textureColorize && o.__textureTint) return o.__textureTint;
    try {
      const id = o.__textureId || (o.fill && o.fill.__texId);
      const e = registryEntry(id);
      if (e && e.img && typeof _averageTextureColor === "function") return _averageTextureColor(e.img, id);
    } catch (_) {}
    return "#cfcfd0";
  }

  // 👻 Fantasma: le tessere selezionate con una texture diventano una
  // famiglia (una per ogni texture+grana+colora diversa, B6: una tessera
  // sta in una famiglia sola, la nuova prende il posto della vecchia).
  function makeGhost(objs) {
    if (busy()) return { ok: false, reason: "busy" };
    const list = (objs ? leaves(objs) : selectedLeaves()).filter((o) => hasPat(o) || o.__textureId);
    if (!list.length) return { ok: false, reason: "noTexture" };
    const groups = new Map();
    list.forEach((o) => {
      const t = o.__textureId || o.fill.__texId;
      const p = o.fill && typeof o.fill === "object" ? o.fill : {};
      const gr = Number(o.__textureSpanMM || p.__spanMM || 14);
      const c = !!(o.__textureColorize || p.__colorize);
      const key = t + "|" + gr + "|" + (c ? 1 : 0);
      if (!groups.has(key)) groups.set(key, { t: t, g: gr, c: c, k: c ? o.__textureTint || p.__tint || null : null, tiles: [] });
      groups.get(key).tiles.push(o);
    });
    const made = [];
    groups.forEach((grp) => {
      const f = newFamilyId();
      grp.tiles.forEach((o) => {
        const own = colorBeforeTexture(o);
        o.set("fill", own);
        stripLabels(o);
        delete o.__textureDataURL;
        o.__ghost = { f: f, t: grp.t, g: grp.g, c: grp.c ? 1 : 0, k: grp.k ? hexOf(grp.k) : null, v: 0 };
        markDirty(o);
      });
      made.push({ f: f, count: grp.tiles.length });
    });
    dropFamCache();
    canvas.requestRenderAll();
    refreshPanel();
    push();
    return { ok: true, families: made };
  }

  // 👻 Mostra una famiglia: la texture su tutte le sue tessere. In fila
  // per colore (la memoria delle tinte tiene 48 colori: a giro non
  // ricorderebbe niente, trappola 271) e da rebuildTextureFill, che
  // parte dall'id (niente impronta del dataURL per tessera, trappola 272).
  function showFamilies(fs, done) {
    if (busy()) {
      if (done) done({ ok: false, reason: "busy" });
      return { ok: false, reason: "busy" };
    }
    const wanted = new Set(fs);
    const members = allLeaves().filter((o) => o.__ghost && wanted.has(o.__ghost.f));
    if (!members.length) {
      if (done) done({ ok: false, reason: "noFamily" });
      return { ok: false, reason: "noFamily" };
    }
    const ids = Array.from(new Set(members.map((o) => o.__ghost.t)));
    const missing = ids.filter((id) => !registryEntry(id));
    if (missing.length) {
      if (done) done({ ok: false, reason: "missingImage", ids: missing });
      return { ok: false, reason: "missingImage", ids: missing };
    }
    const result = { ok: true, shown: 0, skipped: 0, pending: true };
    let waiting = ids.length;
    const go = () => {
      const order = members.slice().sort((a, b) => {
        const ka = a.__ghost.t + "|" + (typeof a.fill === "string" ? hexOf(a.fill) : "");
        const kb = b.__ghost.t + "|" + (typeof b.fill === "string" ? hexOf(b.fill) : "");
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      order.forEach((o) => {
        const g = o.__ghost;
        if (showsFamily(o)) {
          g.v = 1;
          return;
        }
        if (hasPat(o)) {
          // B7: una texture sua, messa a mano, vince.
          delete g.b;
          g.v = 1;
          result.skipped++;
          return;
        }
        if (showOne(o)) result.shown++;
      });
      result.pending = false;
      dropFamCache();
      canvas.requestRenderAll();
      refreshPanel();
      if (result.shown) push();
      if (done) done(result);
    };
    ids.forEach((id) => {
      const e = registryEntry(id);
      const fin = () => {
        if (--waiting === 0) go();
      };
      if (e.img) fin();
      else if (typeof ensureRegisteredImage === "function") ensureRegisteredImage(id, fin);
      else fin();
    });
    return result;
  }

  function hideFamilies(fs) {
    if (busy()) return { ok: false, reason: "busy" };
    const wanted = new Set(fs);
    const members = allLeaves().filter((o) => o.__ghost && wanted.has(o.__ghost.f));
    if (!members.length) return { ok: false, reason: "noFamily" };
    let hidden = 0;
    members.forEach((o) => {
      if (hideOne(o)) hidden++;
    });
    dropFamCache();
    canvas.requestRenderAll();
    refreshPanel();
    if (hidden) push();
    return { ok: true, hidden: hidden };
  }

  function families() {
    const m = new Map();
    allLeaves().forEach((o) => {
      const g = o.__ghost;
      if (!g || !g.f) return;
      let e = m.get(g.f);
      if (!e) m.set(g.f, (e = { f: g.f, t: g.t, g: g.g, c: g.c, k: g.k, count: 0, showing: 0 }));
      e.count++;
      if (showsFamily(o)) e.showing++;
    });
    return Array.from(m.values()).map((e) => Object.assign(e, { shown: e.showing > 0 }));
  }

  window.textureGhost = {
    version: TG_VERSION,
    makeGhost: makeGhost,
    show: (x, done) => {
      const f = familyIdOf(x || canvas.getActiveObject());
      return f ? showFamilies([f], done) : { ok: false, reason: "noFamily" };
    },
    hide: (x) => {
      const f = familyIdOf(x || canvas.getActiveObject());
      return f ? hideFamilies([f]) : { ok: false, reason: "noFamily" };
    },
    showAll: (done) => {
      const fs = families().map((e) => e.f);
      return fs.length ? showFamilies(fs, done) : { ok: false, reason: "noFamily" };
    },
    hideAll: () => {
      const fs = families().map((e) => e.f);
      return fs.length ? hideFamilies(fs) : { ok: false, reason: "noFamily" };
    },
    families: families,
    familyOf: (o) => familyIdOf(o),
    isShown: (f) => {
      const e = families().find((x) => x.f === familyIdOf(f));
      return !!(e && e.shown);
    },
    members: (f) => membersOf(familyIdOf(f)),
    // Fetta 2: il nome di una famiglia come lo mostra l'interfaccia, e il
    // giro che rifà ispettore e popover (per le prove).
    familyName: (f) => {
      const e = families().find((x) => x.f === familyIdOf(f));
      return e ? familyName(e) : null;
    },
    refreshUI: () => updateGhostUI(true),
    // Fetta 3: quanto costerebbe mostrare (per le prove e per chi controlla
    // dalla console) e lo stato della memoria delle tinte.
    estimateShow: (x) => {
      const fs = x ? [familyIdOf(x)].filter(Boolean) : families().map((e) => e.f);
      return estimateShow(fs);
    },
    tints: () => ({ kept: _tintKeep.size, hits: _tintStat.hits, misses: _tintStat.misses, computed: _tintStat.computed }),
    pruneTints: () => pruneTints()
  };

  // ════════════════════════════════════════════════════════════════
  //  L'INTERFACCIA (Fetta 2): l'ispettore e il popover ▦
  // ════════════════════════════════════════════════════════════════
  // I testi: chiave di i18n.js, col testo italiano di riserva (come __t
  // di renderer.js). La lingua cambia ricaricando la finestra.
  function tr(key, params, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const v = window.i18n.t(key, params);
        if (typeof v === "string" && v !== key) return v;
      }
    } catch (_) {}
    let s = String(fallback != null ? fallback : key);
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
    }
    return s;
  }
  function toast(key, params, fallback) {
    try {
      if (typeof window.flashToast === "function") window.flashToast(tr(key, params, fallback));
    } catch (_) {}
  }
  function byId(id) {
    return document.getElementById(id);
  }

  // Il nome dell'immagine: lo stesso della miniatura nella colonna Texture
  // (le procedurali nella lingua giusta, le altre col nome del file). L'id
  // del registro è l'impronta del dataURL (_texHash di renderer.js): si
  // calcola una volta per miniatura.
  const _thumbIds = new WeakMap();
  const _labels = new Map();
  function textureLabel(t) {
    if (!t) return null;
    if (_labels.has(t)) return _labels.get(t);
    try {
      if (typeof _texHash === "function") {
        document.querySelectorAll("#textureGrid .textureThumb").forEach((img) => {
          let id = _thumbIds.get(img);
          if (!id) {
            const src = img.getAttribute("src") || "";
            if (!src) return;
            id = _texHash(src);
            _thumbIds.set(img, id);
          }
          if (!_labels.has(id) && img.title) _labels.set(id, img.title.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, ""));
        });
      }
    } catch (_) {}
    return _labels.get(t) || null;
  }
  function fmtMM(g) {
    const n = Number(g);
    return (Number.isFinite(n) ? n : 14).toFixed(1) + " mm";
  }
  function familyName(e) {
    const lbl = textureLabel(e.t) || tr("ghost.family.unnamed", null, "Texture");
    return lbl + " · " + fmtMM(e.g) + (e.c ? " · 🎨" : "");
  }

  // La miniatura dell'immagine (dal registro: niente file nuovi).
  function thumbEl(t) {
    const box = document.createElement("span");
    box.className = "tg-thumb";
    const e = registryEntry(t);
    try {
      if (e && e.img) {
        const c = document.createElement("canvas");
        c.width = c.height = 44;
        const sw = e.img.naturalWidth || e.img.width || 44;
        const sh = e.img.naturalHeight || e.img.height || 44;
        const s = Math.max(1, Math.min(sw, sh));
        c.getContext("2d").drawImage(e.img, (sw - s) / 2, (sh - s) / 2, s, s, 0, 0, 44, 44);
        box.appendChild(c);
      } else if (e && e.dataURL) {
        const i = document.createElement("img");
        i.alt = "";
        i.src = e.dataURL;
        box.appendChild(i);
      }
    } catch (_) {}
    return box;
  }

  // ── gli avvisi dei comandi ──
  function reportMake(r) {
    if (!r || !r.ok) {
      if (r && r.reason === "noTexture") toast("toast.ghost.noTexture", null, "❌ Seleziona una tessera con una texture");
      return;
    }
    const tiles = r.families.reduce((s, x) => s + x.count, 0);
    if (r.families.length === 1) {
      const e = families().find((x) => x.f === r.families[0].f);
      toast(
        "toast.ghost.made",
        { name: e ? familyName(e) : "", count: tiles },
        "👻 Texture fantasma «{name}» (tessere: {count}): la texture si nasconde, le copie entrano nella famiglia"
      );
    } else {
      toast(
        "toast.ghost.madeMany",
        { n: r.families.length, count: tiles },
        "👻 {n} famiglie fantasma (tessere: {count}): la texture si nasconde, le copie entrano nella famiglia"
      );
    }
  }
  function reportShow(r) {
    if (!r || !r.ok) {
      if (r && r.reason === "missingImage") {
        toast("toast.ghost.missingImage", null, "❌ Manca l'immagine della texture: rimettila su una tessera dalla colonna Texture");
      }
      return;
    }
    if (r.skipped) {
      toast(
        "toast.ghost.shownSkipped",
        { count: r.shown, skipped: r.skipped },
        "👻 Texture fantasma mostrata (tessere: {count}); {skipped} con una texture loro restano com'erano"
      );
    } else if (r.shown) {
      toast("toast.ghost.shown", { count: r.shown }, "👻 Texture fantasma mostrata (tessere: {count})");
    } else {
      toast("toast.ghost.alreadyShown", null, "👻 La texture fantasma è già mostrata");
    }
  }
  function reportHide(r) {
    if (!r || !r.ok) return;
    toast("toast.ghost.hidden", { count: r.hidden }, "👻 Texture fantasma nascosta (tessere: {count})");
  }
  function afterCommand() {
    updateGhostUI(true);
  }
  // Fetta 3: se il Mostra sarà lungo (più di SHOW_WARN_MS, a stima), prima
  // l'avviso «⏳», poi il lavoro: due fotogrammi d'attesa perché l'avviso
  // arrivi davvero a schermo prima che la pagina si fermi a fare i conti.
  // Un secondo clic mentre si aspetta non fa niente.
  const SHOW_WARN_MS = 500;
  let _showWaiting = false;
  function doShow(fs) {
    if (_showWaiting) return;
    const run = () => {
      showFamilies(fs, (r) => {
        reportShow(r);
        afterCommand();
      });
    };
    let est = null;
    try {
      est = estimateShow(fs);
    } catch (_) {}
    if (!est || est.ms <= SHOW_WARN_MS) return run();
    toast("toast.ghost.working", { count: est.tiles, n: est.tints }, "⏳ Texture fantasma: preparo {n} colori per {count} tessere…");
    _showWaiting = true;
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      _showWaiting = false;
      run();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 250); // se i fotogrammi non arrivano (finestra coperta), si parte lo stesso
  }
  function doHide(fs) {
    reportHide(hideFamilies(fs));
    afterCommand();
  }

  // ── l'ispettore ──
  let _inspSig = null;
  function updateInspector(force) {
    const block = byId("inspectorGhostBlock");
    if (!block) return;
    const sel = selectedLeaves();
    const fset = new Set();
    let candidates = 0;
    sel.forEach((o) => {
      if (o.__ghost && o.__ghost.f) fset.add(o.__ghost.f);
      if ((hasPat(o) || o.__textureId) && !showsFamily(o)) candidates++;
    });
    if (!fset.size && !candidates) {
      if (block.style.display !== "none") block.style.display = "none";
      _inspSig = null;
      return;
    }
    const fams = fset.size ? families().filter((e) => fset.has(e.f)) : [];
    const name = fams.length === 1 ? familyName(fams[0]) : "";
    const sig =
      fams.map((e) => e.f + ":" + e.count + ":" + e.showing).join(",") + "|" + (candidates ? 1 : 0) + "|" + name;
    if (block.style.display === "none") block.style.display = "block";
    if (!force && sig === _inspSig) return;
    _inspSig = sig;

    const info = byId("ghostFamilyInfo");
    const thumbBox = byId("ghostFamilyThumb");
    const nameEl = byId("ghostFamilyName");
    const subEl = byId("ghostFamilySub");
    const toggle = byId("ghostToggleBtn");
    const make = byId("ghostMakeBtn");
    if (fams.length) {
      const total = fams.reduce((s, e) => s + e.count, 0);
      const nShown = fams.filter((e) => e.shown).length;
      const state = nShown === fams.length ? "shown" : nShown ? "mixed" : "hidden";
      if (info) info.style.display = "flex";
      if (thumbBox) {
        thumbBox.textContent = "";
        thumbBox.appendChild(thumbEl(fams[0].t));
      }
      if (nameEl) {
        nameEl.textContent =
          fams.length === 1 ? name : tr("inspector.ghost.families", { n: fams.length }, "{n} famiglie");
        nameEl.title = nameEl.textContent;
      }
      if (subEl) {
        const fb = { shown: "tessere: {count} · mostrata", hidden: "tessere: {count} · nascosta", mixed: "tessere: {count} · in parte mostrate" };
        subEl.textContent = tr("inspector.ghost.state." + state, { count: total }, fb[state]);
      }
      if (toggle) {
        const hide = state === "shown";
        const one = fams.length === 1;
        toggle.dataset.mode = hide ? "hide" : "show";
        toggle.textContent = hide
          ? one
            ? tr("inspector.ghost.hide", null, "👻 Nascondi la famiglia")
            : tr("inspector.ghost.hideMany", null, "👻 Nascondi le famiglie")
          : one
            ? tr("inspector.ghost.show", null, "👻 Mostra la famiglia")
            : tr("inspector.ghost.showMany", null, "👻 Mostra le famiglie");
        toggle.style.display = "";
      }
    } else {
      if (info) info.style.display = "none";
      if (toggle) toggle.style.display = "none";
    }
    if (make) make.style.display = candidates ? "" : "none";
  }

  function selectedFamilies() {
    const s = new Set();
    selectedLeaves().forEach((o) => {
      if (o.__ghost && o.__ghost.f) s.add(o.__ghost.f);
    });
    return Array.from(s);
  }

  // ── il popover ▦ ──
  function popOpen() {
    const pop = byId("textureAllPopover");
    return !!(pop && pop.getAttribute("aria-hidden") === "false");
  }
  // renderer.js mette il popover al suo posto PRIMA che la sezione si
  // riempia: se adesso esce dal fondo della finestra, si alza.
  function clampPopover() {
    const pop = byId("textureAllPopover");
    if (!pop || !popOpen()) return;
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - 8) {
      pop.style.top = Math.max(8, Math.round(window.innerHeight - pr.height - 8)) + "px";
    }
  }
  function buildPopover() {
    const list = byId("ghostPopList");
    if (!list) return;
    const fams = families();
    list.textContent = "";
    fams.forEach((e) => {
      const row = document.createElement("div");
      row.className = "tg-pop-row" + (e.shown ? " on" : "");
      row.dataset.f = e.f;
      row.appendChild(thumbEl(e.t));
      const txt = document.createElement("span");
      txt.className = "tg-fam-text";
      const nm = document.createElement("span");
      nm.className = "tg-fam-name";
      nm.textContent = familyName(e);
      const sub = document.createElement("span");
      sub.className = "tg-fam-sub";
      sub.textContent = tr(
        e.shown ? "texturePanel.ghost.rowShown" : "texturePanel.ghost.rowHidden",
        { count: e.count },
        e.shown ? "tessere: {count} · mostrata" : "tessere: {count} · nascosta"
      );
      txt.appendChild(nm);
      txt.appendChild(sub);
      row.title = nm.textContent;
      row.appendChild(txt);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mwp-pop-btn tg-pop-toggle";
      b.dataset.f = e.f;
      b.dataset.mode = e.shown ? "hide" : "show";
      b.textContent = e.shown ? tr("texturePanel.ghost.hide", null, "Nascondi") : tr("texturePanel.ghost.show", null, "Mostra");
      row.appendChild(b);
      list.appendChild(row);
    });
    const empty = byId("ghostPopEmpty");
    if (empty) empty.style.display = fams.length ? "none" : "";
    const acts = byId("ghostPopAllActions");
    if (acts) acts.style.display = fams.length ? "" : "none";
    const sa = byId("ghostShowAllBtn");
    const ha = byId("ghostHideAllBtn");
    if (sa) sa.disabled = !fams.some((e) => !e.shown);
    if (ha) ha.disabled = !fams.some((e) => e.shown);
    clampPopover();
  }

  function updateGhostUI(force) {
    try {
      updateInspector(force === true);
      if (popOpen()) buildPopover();
    } catch (e) {
      console.warn("[textureGhost] interfaccia", e);
    }
  }

  // updateTextureGrainPanel (porta b): la chiamano la selezione, lo
  // spostamento, l'annulla, la colonna Texture e «Togli da tutte». Il
  // blocco fantasma si aggiorna con lei (se niente è cambiato non si
  // tocca il DOM), e le righe del popover ▦ se è aperto.
  if (typeof window.updateTextureGrainPanel === "function" && !window.updateTextureGrainPanel.__tgWrapped) {
    const origPanel = window.updateTextureGrainPanel;
    const w = function () {
      const r = origPanel.apply(this, arguments);
      updateGhostUI(false);
      return r;
    };
    w.__tgWrapped = true;
    window.updateTextureGrainPanel = w;
  }

  function initUI() {
    const make = byId("ghostMakeBtn");
    if (make) {
      make.addEventListener("click", () => {
        reportMake(makeGhost());
        afterCommand();
        make.blur();
      });
    }
    const toggle = byId("ghostToggleBtn");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const fs = selectedFamilies();
        toggle.blur();
        if (!fs.length) return;
        if (toggle.dataset.mode === "hide") doHide(fs);
        else doShow(fs);
      });
    }
    const list = byId("ghostPopList");
    if (list) {
      list.addEventListener("click", (e) => {
        const b = e.target && e.target.closest ? e.target.closest(".tg-pop-toggle") : null;
        if (!b || !b.dataset.f) return;
        if (b.dataset.mode === "hide") doHide([b.dataset.f]);
        else doShow([b.dataset.f]);
      });
    }
    const sa = byId("ghostShowAllBtn");
    if (sa) {
      sa.addEventListener("click", () => {
        const fs = families().map((e) => e.f);
        if (fs.length) doShow(fs);
      });
    }
    const ha = byId("ghostHideAllBtn");
    if (ha) {
      ha.addEventListener("click", () => {
        const fs = families().map((e) => e.f);
        if (fs.length) doHide(fs);
      });
    }
    // Il popover si apre da renderer.js: la sezione si rifà quando cambia
    // il suo aria-hidden (nessuna riga di renderer.js).
    const pop = byId("textureAllPopover");
    if (pop && typeof MutationObserver === "function") {
      new MutationObserver(() => {
        if (popOpen()) {
          try {
            buildPopover();
          } catch (err) {
            console.warn("[textureGhost] popover", err);
          }
        }
      }).observe(pop, { attributes: true, attributeFilter: ["aria-hidden"] });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initUI);
  else initUI();

  console.log("[textureGhost] pronto (Fetta " + TG_VERSION + ")");
})();
