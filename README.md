# ToDxf

Converte immagini (**JPG, JPEG, PNG, WEBP, BMP, GIF, AVIF, SVG**) in file **DXF** da aprire in **ArtCAM 2016**, per serigrafia/incisione a **doppia linea** o a **singola linea**.

**Usala online: https://todxf.vercel.app** (copia anche su https://mikidefu.github.io/ToDxf/)

È una web app che gira interamente nel browser: niente da installare, e le immagini non vengono mai caricate su internet (anche dalla versione online l'elaborazione avviene sul tuo computer). Scaricando il progetto funziona anche offline.

## Come si usa

1. Apri il [link online](https://mikidefu.github.io/ToDxf/), oppure `index.html` con un doppio clic (Chrome, Edge o Firefox).
2. Trascina l'immagine nella pagina, oppure clicca sul riquadro, oppure incollala con `Ctrl+V`.
3. Scegli il tipo di serigrafia:
   - **Doppia linea**: il contorno di entrambi i bordi di ogni forma. Ogni tratto diventa un profilo chiuso (esterno + eventuali fori).
   - **Singola linea**: la linea centrale del tratto, un solo vettore per tratto. È adatta all'incisione con fresa a V o a punta.
4. Regola i parametri guardando l'anteprima (rosso = doppia linea, blu = singola linea).
5. Imposta le dimensioni finali e clicca **Scarica DXF**.

### Parametri

| Parametro | A cosa serve |
|---|---|
| **Soglia** | Separa il disegno dallo sfondo. *Automatica* (metodo di Otsu) va bene quasi sempre. |
| **Inverti** | Da attivare se il disegno è chiaro su fondo scuro. |
| **Sfocatura bordi** | Ammorbidisce i bordi prima della vettorizzazione: utile per foto e JPG compressi. |
| **Rimuovi macchie sotto** | Elimina puntini e sporcizia più piccoli della soglia e chiude i piccoli buchi. |
| **Risoluzione di lavoro** | Più alta vuol dire più dettaglio ma elaborazione più lenta. Le immagini piccole vengono ingrandite (fino a 4×) per avere curve più morbide. |
| **Curve lisce (archi) / Polilinee** | *Curve lisce* approssima i tratti con archi raccordati (tangenti continue): linee morbide con pochi nodi, ideali per la fresatura. *Polilinee* usa solo segmenti dritti, da scegliere se un programma non legge bene gli archi. |
| **Levigatura** | Toglie la scalettatura e le piccole ondulazioni dei pixel. |
| **Tolleranza** | Scostamento massimo consentito dal tratto originale (in pixel di lavoro): più alta dà meno nodi, più bassa è più fedele. |
| **Elimina rametti sotto** | Solo per la singola linea. Toglie le diramazioni corte che nascono agli angoli e sulle grazie dei caratteri. |
| **Prolunga le estremità fino alla punta** | Solo per la singola linea. La linea centrale arriva fino in fondo al tratto invece di fermarsi mezzo spessore prima. |

### Dimensioni

- **Larghezza in mm**: indichi la larghezza finale, l'altezza segue le proporzioni.
- **Da DPI**: la dimensione viene calcolata dai DPI dell'immagine. Se il file li contiene (PNG, JPG), vengono letti in automatico.

## Aprire il DXF in ArtCAM 2016

Il file è un **DXF R12** in **millimetri**, con l'origine (0,0) in basso a sinistra. I vettori sono polilinee sul layer `DOPPIA_LINEA` o `SINGOLA_LINEA`; con *Curve lisce* i segmenti sono archi (bulge), che ArtCAM importa come curve vere.

1. Crea un nuovo modello grande almeno quanto il disegno, oppure apri il modello esistente.
2. Usa **Importa vettori** (*Import Vector Data*) e scegli il file `.dxf`.
3. Se servono curve ancora più morbide per la lavorazione, usa gli strumenti di ArtCAM per unire, levigare o adattare curve ai vettori (*Join*, *Smooth*, *Fit Curves to Vectors*).

## Suggerimenti

- Per la **singola linea** servono immagini con tratti di spessore abbastanza uniforme: scritte, disegni al tratto, loghi lineari. Sulle forme piene lo scheletro produce rami interni.
- Negli incroci (come la *t*) i tratti che proseguono dritti restano un unico vettore continuo; gli altri vengono raccordati al tratto più vicino.
- Se compaiono vettori spezzati o buchi, alza la **Risoluzione di lavoro** o abbassa la **Sfocatura**.
- Se compaiono troppi puntini, alza **Rimuovi macchie**.

## Struttura del progetto

```
index.html          interfaccia
css/style.css       stile (tema chiaro e scuro)
js/imageproc.js     scala di grigi, sfocatura, soglia di Otsu, pulizia macchie
js/contour.js       doppia linea: contorni con marching squares e precisione sub-pixel
js/centerline.js    singola linea: scheletro Zhang–Suen, grafo, rametti, incroci, raccordi
js/geometry.js      levigatura (Taubin, gaussiana), semplificazione (RDP), biarchi
js/vectorize.js     pipeline completa immagine -> vettori
js/dxf.js           scrittura DXF R12 in mm
js/dpi.js           lettura dei DPI da PNG e JPEG
js/app.js           anteprima, zoom e download
tests/run-tests.js  test automatici degli algoritmi
```

## Test

Serve [Node.js](https://nodejs.org/):

```bash
npm test
```
