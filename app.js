// === DOM-ELEMENTIT ===
const openBtn = document.getElementById('open-btn');
const pdfUpload = document.getElementById('pdf-upload');
const saveBtn = document.getElementById('save-btn');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const pageInput = document.getElementById('page-input');
const pageIndicator = document.getElementById('page-indicator');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomLevelSpan = document.getElementById('zoom-level');
const mainContainer = document.getElementById('main-container');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const toolButtons = document.querySelectorAll('.tool-btn');
const thumbnailSidebar = document.getElementById('thumbnail-sidebar');
const contextMenu = document.getElementById('context-menu');
const pageContextMenu = document.getElementById('page-context-menu');

// Ominaisuus-paneelin elementit
const propertiesSidebar = document.getElementById('properties-sidebar');
const propX = document.getElementById('prop-x');
const propY = document.getElementById('prop-y');
const propW = document.getElementById('prop-w');
const propH = document.getElementById('prop-h');
const textPropsSection = document.getElementById('text-props-section');
const fontSelect = document.getElementById('font-select');
const fontSizeInput = document.getElementById('font-size-input');
const colorPicker = document.getElementById('color-picker');
const boldBtn = document.getElementById('bold-btn');
const italicBtn = document.getElementById('italic-btn');
const alignButtons = document.querySelectorAll('.align-btn');
const highlightPropsSection = document.getElementById('highlight-props-section');
const highlightColorPicker = document.getElementById('highlight-color-picker');
const highlightOpacitySlider = document.getElementById('highlight-opacity-slider');
const opacityValue = document.getElementById('opacity-value');
const coverPropsSection = document.getElementById('cover-props-section');
const coverColorPicker = document.getElementById('cover-color-picker');


// === SOVELLUKSEN TILA ===
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js`;

let pdfDoc = null;
let currentPageIndex = 0;
let totalPages = 0;
let pageOrder = [];
let zoomLevel = 1.0;
let originalPdfBytes = null;
let pageRotations = {}; // { pageNum: degrees } - sivujen kierrot
let blankPages = []; // Tyhjien sivujen indeksit (negatiiviset arvot)

let currentTool = 'select';
let annotations = {};
let isDrawing = false;
let startCoords = { x: 0, y: 0 };

let canvasSnapshot = null;
let selectedItem = null;
let isMoving = false;
let originalItemPos = { x: 0, y: 0 };

let isResizing = false;
let activeHandle = null;
const resizeHandleSize = 8;
let originalItemForResize = null;

let undoStack = [];
let redoStack = [];

let isRendering = false;
let pageChangeDebounce = false;


// === YDINTOIMINNOT ===

async function loadPdf(file) {
    const fileReader = new FileReader();
    fileReader.onload = async function() {
        originalPdfBytes = this.result;
        try {
            const dataForPdfJs = new Uint8Array(originalPdfBytes.slice(0));
            pdfDoc = await pdfjsLib.getDocument(dataForPdfJs).promise;
            totalPages = pdfDoc.numPages;
            currentPageIndex = 0;
            pageOrder = Array.from({ length: totalPages }, (_, i) => i + 1);
            zoomLevel = 1.0;
            annotations = {};
            pageRotations = {};
            blankPages = [];
            selectedItem = null;
            undoStack = [];
            redoStack = [];

            await renderThumbnails();
            renderPage(currentPageIndex);
        } catch (error) {
            console.error('Virhe PDF-tiedoston latauksessa:', error);
            alert('PDF-tiedoston avaaminen epäonnistui.');
        }
    };
    fileReader.readAsArrayBuffer(file);
}

async function renderPage(pageIndex, scrollPosition = 'top') {
    if (isRendering) return;
    if (!pdfDoc || pageIndex < 0 || pageIndex >= totalPages) return;

    isRendering = true;
    try {
        isDrawing = false;
        isMoving = false;
        isResizing = false;
        currentPageIndex = pageIndex;

        const pageNum = pageOrder[pageIndex];

        // Tarkista onko tyhjä sivu (negatiivinen numero)
        if (pageNum < 0) {
            // Renderöi tyhjä sivu
            const defaultWidth = 595; // A4 leveys pisteinä
            const defaultHeight = 842; // A4 korkeus pisteinä
            canvas.width = defaultWidth * zoomLevel;
            canvas.height = defaultHeight * zoomLevel;
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            drawAnnotations(pageNum);
            updateUi();
            return;
        }

        const page = await pdfDoc.getPage(pageNum);
        const rotation = pageRotations[pageNum] || 0;
        const viewport = page.getViewport({ scale: zoomLevel, rotation: rotation });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        await page.render(renderContext).promise;

        drawAnnotations(pageNum);
        updateUi();

        if (scrollPosition === 'bottom') {
            canvasContainer.scrollTop = canvasContainer.scrollHeight;
        } else {
            canvasContainer.scrollTop = 0;
        }

    } catch (error) {
        console.error("Sivun renderöinti epäonnistui:", error);
    } finally {
        isRendering = false;
    }
}

function updateUi() {
    if (!pdfDoc) {
        pageInput.value = 0;
        pageIndicator.textContent = '/ 0';
        saveBtn.disabled = true;
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
        return;
    }
    
    pageInput.value = currentPageIndex + 1;
    pageIndicator.textContent = `/ ${totalPages}`;
    
    zoomLevelSpan.textContent = `${Math.round(zoomLevel * 100)}%`;
    saveBtn.disabled = false;
    prevPageBtn.disabled = currentPageIndex <= 0;
    nextPageBtn.disabled = currentPageIndex >= totalPages - 1;

    toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === currentTool));
    
    canvas.className = '';
    if (['text', 'rect_erase', 'highlight'].includes(currentTool)) {
        canvas.classList.add('crosshair-cursor');
    }
    
    document.querySelectorAll('.thumbnail-item').forEach((item) => {
        const thumb = item;
        if (item.classList.toggle('active', parseInt(item.dataset.pageIndex) === currentPageIndex)) {
            thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
    
    if (selectedItem) {
        propertiesSidebar.classList.remove('hidden');
        mainContainer.classList.remove('sidebar-hidden');
        populatePropertiesPanel();
    } else {
        propertiesSidebar.classList.add('hidden');
        mainContainer.classList.add('sidebar-hidden');
    }

    updateUndoRedoButtons();
}

function populatePropertiesPanel() {
    if (!selectedItem) return;

    propX.value = Math.round(selectedItem.x);
    propY.value = Math.round(selectedItem.y);
    propW.value = Math.round(selectedItem.width);
    propH.value = Math.round(selectedItem.height);

    textPropsSection.style.display = selectedItem.type === 'text' ? 'block' : 'none';
    highlightPropsSection.style.display = selectedItem.type === 'highlight' ? 'block' : 'none';
    coverPropsSection.style.display = selectedItem.type === 'rect_erase' ? 'block' : 'none';

    if (selectedItem.type === 'text') {
        fontSelect.value = selectedItem.font;
        fontSizeInput.value = parseFloat(selectedItem.size).toFixed(1);
        colorPicker.value = selectedItem.color;
        boldBtn.classList.toggle('active', selectedItem.bold);
        italicBtn.classList.toggle('active', selectedItem.italic);
        alignButtons.forEach(btn => {
            btn.classList.toggle('active', btn.id.includes(selectedItem.align || 'left'));
        });
    } else if (selectedItem.type === 'highlight') {
        highlightColorPicker.value = selectedItem.color;
        highlightOpacitySlider.value = selectedItem.opacity;
        opacityValue.textContent = `${Math.round(selectedItem.opacity * 100)}%`;
    } else if (selectedItem.type === 'rect_erase') {
        coverColorPicker.value = selectedItem.color;
    }
}


// === PIENOISKUVAKKEET ===

async function renderThumbnails() {
    thumbnailSidebar.innerHTML = '';

    for (let i = 0; i < totalPages; i++) {
        const pageNum = pageOrder[i];

        const container = document.createElement('div');
        container.className = 'thumbnail-item';
        container.dataset.pageIndex = i;
        container.setAttribute('draggable', true);

        const thumbCanvas = document.createElement('canvas');
        const thumbCtx = thumbCanvas.getContext('2d');

        const pageNumLabel = document.createElement('p');
        pageNumLabel.textContent = `Sivu ${i + 1}`;

        // Tarkista onko tyhjä sivu
        if (pageNum < 0) {
            // Tyhjä sivu - A4 pikkukuva
            const defaultWidth = 595;
            const defaultHeight = 842;
            const scale = 150 / defaultWidth;
            thumbCanvas.width = defaultWidth * scale;
            thumbCanvas.height = defaultHeight * scale;
            thumbCtx.fillStyle = 'white';
            thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
            // Piirretään ohut reunus
            thumbCtx.strokeStyle = '#ccc';
            thumbCtx.lineWidth = 1;
            thumbCtx.strokeRect(0, 0, thumbCanvas.width, thumbCanvas.height);
        } else {
            // Normaali PDF-sivu
            const page = await pdfDoc.getPage(pageNum);
            const rotation = pageRotations[pageNum] || 0;
            const viewport = page.getViewport({ scale: 1.0, rotation: rotation });
            const scale = 150 / Math.max(viewport.width, viewport.height);
            const scaledViewport = page.getViewport({ scale, rotation });

            thumbCanvas.height = scaledViewport.height;
            thumbCanvas.width = scaledViewport.width;

            const renderContext = {
                canvasContext: thumbCtx,
                viewport: scaledViewport,
            };
            await page.render(renderContext).promise;
        }

        container.appendChild(thumbCanvas);
        container.appendChild(pageNumLabel);
        thumbnailSidebar.appendChild(container);

        container.addEventListener('click', () => {
            renderPage(i);
        });

        // Kontekstivalikon käsittelijä pikkukuvalle
        const currentIndex = i; // Tallennetaan indeksi sulkeumaan
        container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideContextMenu();
            hidePageContextMenu();

            pageContextMenu.style.top = `${e.clientY}px`;
            pageContextMenu.style.left = `${e.clientX}px`;
            pageContextMenu.classList.remove('hidden');

            // Kierrä myötäpäivään
            document.getElementById('ctx-page-rotate-cw').onclick = () => {
                rotatePage(currentIndex, 90);
                hidePageContextMenu();
            };

            // Kierrä vastapäivään
            document.getElementById('ctx-page-rotate-ccw').onclick = () => {
                rotatePage(currentIndex, -90);
                hidePageContextMenu();
            };

            // Lisää tyhjä sivu
            document.getElementById('ctx-page-add-blank').onclick = () => {
                addBlankPage(currentIndex);
                hidePageContextMenu();
            };

            // Tallenna sivu
            document.getElementById('ctx-page-save').onclick = () => {
                saveSinglePage(currentIndex);
                hidePageContextMenu();
            };

            // Poista sivu
            document.getElementById('ctx-page-delete').onclick = () => {
                deletePage(currentIndex);
                hidePageContextMenu();
            };
        });
    }
    addDragAndDropListeners();
}


// === KUMOA/TOISTA -FUNKTIOT ===

function addUndoAction(command) {
    undoStack.push(command);
    redoStack = [];
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
}

function undo() {
    if (undoStack.length === 0) return;
    const command = undoStack.pop();
    
    switch (command.action) {
        case 'add':
            const pageAnnosAdd = annotations[command.pageIndex] || [];
            const indexAdd = pageAnnosAdd.findIndex(a => a === command.item);
            if (indexAdd > -1) pageAnnosAdd.splice(indexAdd, 1);
            break;
        case 'delete':
            if (!annotations[command.pageIndex]) annotations[command.pageIndex] = [];
            annotations[command.pageIndex].splice(command.originalIndex, 0, command.item);
            break;
        case 'move':
            command.item.x = command.from.x;
            command.item.y = command.from.y;
            break;
        case 'style':
        case 'resize':
            Object.assign(command.item, command.from);
            break;
        case 'order':
        case 'delete_page':
        case 'add_page':
            pageOrder = command.from;
            totalPages = pageOrder.length;
            renderThumbnails();
            break;
    }
    
    redoStack.push(command);
    renderPage(currentPageIndex);
}

function redo() {
    if (redoStack.length === 0) return;
    const command = redoStack.pop();

    switch (command.action) {
        case 'add':
            if (!annotations[command.pageIndex]) annotations[command.pageIndex] = [];
            annotations[command.pageIndex].push(command.item);
            break;
        case 'delete':
            const pageAnnosDelete = annotations[command.pageIndex] || [];
            const indexDelete = pageAnnosDelete.findIndex(a => a === command.item);
            if (indexDelete > -1) pageAnnosDelete.splice(indexDelete, 1);
            break;
        case 'move':
            command.item.x = command.to.x;
            command.item.y = command.to.y;
            break;
        case 'style':
        case 'resize':
            Object.assign(command.item, command.to);
            break;
        case 'order':
        case 'delete_page':
        case 'add_page':
            pageOrder = command.to;
            totalPages = pageOrder.length;
            renderThumbnails();
            break;
    }

    undoStack.push(command);
    renderPage(currentPageIndex);
}

// === ANNOTAATIOT & PIIRTÄMINEN ===

function drawAnnotations(pageNum) {
    const pageAnnotations = annotations[pageNum] || [];
    
    pageAnnotations
        .filter(anno => anno.type === 'rect_erase')
        .forEach(anno => drawSingleAnnotation(anno));
    
    pageAnnotations
        .filter(anno => anno.type === 'text')
        .forEach(anno => drawSingleAnnotation(anno));

    pageAnnotations
        .filter(anno => anno.type === 'highlight')
        .forEach(anno => drawSingleAnnotation(anno));
}

function drawSingleAnnotation(anno) {
    const canvasX = anno.x * zoomLevel;
    const canvasY = anno.y * zoomLevel;
    const canvasW = anno.width * zoomLevel;
    const canvasH = anno.height * zoomLevel;
    
    if (anno.type === 'rect_erase') {
        ctx.fillStyle = anno.color;
        ctx.fillRect(canvasX, canvasY, canvasW, canvasH);
    }
    else if (anno.type === 'highlight') {
        const color = anno.color;
        const opacity = anno.opacity;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.fillRect(canvasX, canvasY, canvasW, canvasH);
    }
    else if (anno.type === 'text') {
        ctx.textBaseline = 'middle';
        const fontWeight = anno.bold ? 'bold' : 'normal';
        const fontStyle = anno.italic ? 'italic' : 'normal';
        ctx.font = `${fontStyle} ${fontWeight} ${anno.size * zoomLevel}px ${anno.font}`;
        ctx.fillStyle = anno.color;
        
        let textX = canvasX;
        ctx.textAlign = anno.align || 'left';
        if (ctx.textAlign === 'center') {
            textX = canvasX + canvasW / 2;
        } else if (ctx.textAlign === 'right') {
            textX = canvasX + canvasW;
        }
        
        const textY = canvasY + canvasH / 2;
        ctx.fillText(anno.text, textX, textY, canvasW);
    }
    
    if (anno === selectedItem) {
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(canvasX, canvasY, canvasW, canvasH);
        ctx.setLineDash([]);

        ctx.fillStyle = '#007bff';
        const s = resizeHandleSize / 2;
        const handles = getResizeHandles(canvasX, canvasY, canvasW, canvasH);
        for(const handle in handles) {
            const pos = handles[handle];
            ctx.fillRect(pos.x - s, pos.y - s, resizeHandleSize, resizeHandleSize);
        }
    }
}

function setTool(tool) {
    currentTool = tool;
    if (tool !== 'select' && selectedItem) {
        selectedItem = null;
        renderPage(currentPageIndex);
    }
    updateUi();
}

// === APUFUNKTIOT ===

function getResizeHandles(x, y, w, h) {
    return { nw: { x, y }, ne: { x: x + w, y }, sw: { x, y: y + h }, se: { x: x + w, y: y + h } };
}

function getHandleAtCoords(canvasX, canvasY) {
    if (!selectedItem) return null;
    const { x, y, width, height } = selectedItem;
    const handles = getResizeHandles(x * zoomLevel, y * zoomLevel, width * zoomLevel, height * zoomLevel);
    
    for (const name in handles) {
        const pos = handles[name];
        if (Math.abs(canvasX - pos.x) <= resizeHandleSize && Math.abs(canvasY - pos.y) <= resizeHandleSize) {
            return name;
        }
    }
    return null;
}

function getItemAtCoords(x, y) {
    const pageNum = pageOrder[currentPageIndex];
    const pageAnnotations = annotations[pageNum] || [];
    for (const anno of [...pageAnnotations].reverse()) {
        if (x >= anno.x && x <= anno.x + anno.width && y >= anno.y && y <= anno.y + anno.height) {
            return anno;
        }
    }
    return null;
}

// === TALLENNUSLOGIIKKA ===

async function savePdf() {
    if (!originalPdfBytes) return;
    await processAndSavePdf(pageOrder);
}

async function saveSinglePage(pageIndex) {
    if (!originalPdfBytes) return;
    const pageNumToSave = pageOrder[pageIndex];
    await processAndSavePdf([pageNumToSave], `sivu_${pageNumToSave}.pdf`);
}

async function processAndSavePdf(pagesToSave, filename = 'muokattu.pdf') {
    try {
        const newPdfDoc = await PDFLib.PDFDocument.create();
        const originalPdfDoc = await PDFLib.PDFDocument.load(originalPdfBytes);

        // Suodata pois negatiiviset sivunumerot (tyhjät sivut) kopiointia varten
        const realPageIndices = pagesToSave
            .filter(p => p > 0)
            .map(p => p - 1);

        // Kopioi vain oikeat PDF-sivut
        const copiedPages = realPageIndices.length > 0
            ? await newPdfDoc.copyPages(originalPdfDoc, realPageIndices)
            : [];

        // Seuraa kopioitujen sivujen indeksiä
        let copiedPageIndex = 0;

        for (let i = 0; i < pagesToSave.length; i++) {
            const originalPageNum = pagesToSave[i];
            const pageAnnotations = annotations[originalPageNum] || [];

            // TYHJÄ SIVU
            if (originalPageNum < 0) {
                // Luo uusi tyhjä A4-sivu
                const pageWidth = 595;
                const pageHeight = 842;
                const newPage = newPdfDoc.addPage([pageWidth, pageHeight]);

                // Lisää annotaatiot tyhjälle sivulle
                await addAnnotationsToPage(newPdfDoc, newPage, pageAnnotations, pageWidth, pageHeight);
                continue;
            }

            // Hae sivun kierto
            const rotation = pageRotations[originalPageNum] || 0;

            // Tarkista onko sivulla peitto-annotaatioita (rect_erase)
            const hasRedaction = pageAnnotations.some(a => a.type === 'rect_erase');

            if (hasRedaction) {
                // RASTEROINTI: Koko sivu muunnetaan kuvaksi, jolloin teksti ei ole kopioitavissa
                const page = await pdfDoc.getPage(originalPageNum);
                const viewport = page.getViewport({ scale: 1.0, rotation: rotation });
                const pageWidth = viewport.width;
                const pageHeight = viewport.height;

                // Rasteroi sivu kuvaksi (kierto huomioituna)
                const imageBytes = await rasterizePageWithRotation(originalPageNum, pageAnnotations, rotation);
                const image = await newPdfDoc.embedPng(imageBytes);

                // Luo uusi sivu ja piirrä kuva sille
                const newPage = newPdfDoc.addPage([pageWidth, pageHeight]);
                newPage.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: pageWidth,
                    height: pageHeight,
                });
            } else {
                // NORMAALI KÄSITTELY: Kopioi sivu ja lisää annotaatiot (teksti säilyy kopioitavana)
                const newPage = newPdfDoc.addPage(copiedPages[copiedPageIndex]);
                copiedPageIndex++;

                // Aseta sivun kierto
                if (rotation !== 0) {
                    newPage.setRotation(PDFLib.degrees(rotation));
                }

                const { width: pageWidth, height: pageHeight } = newPage.getSize();

                // Lisää annotaatiot
                await addAnnotationsToPage(newPdfDoc, newPage, pageAnnotations, pageWidth, pageHeight);
            }
        }

        const pdfBytes = await newPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

    } catch (error) {
        console.error('Virhe PDF-tiedoston tallennuksessa:', error);
        alert('PDF-tiedoston tallennus epäonnistui.');
    }
}

// Apufunktio annotaatioiden lisäämiseen sivulle
async function addAnnotationsToPage(newPdfDoc, newPage, pageAnnotations, pageWidth, pageHeight) {
    const fontCache = {};

    async function getFont(name, bold, italic) {
        let fontName = name;
        if (bold && italic) fontName = `${name}-BoldItalic`;
        else if (bold) fontName = `${name}-Bold`;
        else if (italic) fontName = `${name}-Italic`;

        if (fontCache[fontName]) return fontCache[fontName];

        let fontEnum;
        if (name === 'Times-Roman') {
            if (bold && italic) fontEnum = PDFLib.StandardFonts.TimesRomanBoldItalic;
            else if (bold) fontEnum = PDFLib.StandardFonts.TimesRomanBold;
            else if (italic) fontEnum = PDFLib.StandardFonts.TimesRomanItalic;
            else fontEnum = PDFLib.StandardFonts.TimesRoman;
        } else if (name === 'Courier') {
            if (bold && italic) fontEnum = PDFLib.StandardFonts.CourierBoldOblique;
            else if (bold) fontEnum = PDFLib.StandardFonts.CourierBold;
            else if (italic) fontEnum = PDFLib.StandardFonts.CourierOblique;
            else fontEnum = PDFLib.StandardFonts.Courier;
        } else {
            if (bold && italic) fontEnum = PDFLib.StandardFonts.HelveticaBoldOblique;
            else if (bold) fontEnum = PDFLib.StandardFonts.HelveticaBold;
            else if (italic) fontEnum = PDFLib.StandardFonts.HelveticaOblique;
            else fontEnum = PDFLib.StandardFonts.Helvetica;
        }

        fontCache[fontName] = await newPdfDoc.embedFont(fontEnum);
        return fontCache[fontName];
    }

    for (const anno of pageAnnotations) {
        if (anno.x > pageWidth || anno.y > pageHeight || anno.x + anno.width < 0 || anno.y + anno.height < 0) {
            continue;
        }

        const drawX = Math.max(0, anno.x);
        const drawY = pageHeight - Math.max(0, anno.y) - anno.height;
        const drawWidth = Math.min(anno.width, pageWidth - drawX);
        const drawHeight = Math.min(anno.height, pageHeight - (pageHeight - drawY - anno.height));

        if (anno.type === 'highlight') {
            const color = hexToRgb(anno.color);
            const opacity = anno.opacity;

            newPage.drawRectangle({
                x: drawX,
                y: drawY,
                width: drawWidth,
                height: drawHeight,
                color: color,
                opacity: opacity,
            });

        } else if (anno.type === 'text') {
            const font = await getFont(anno.font, anno.bold, anno.italic);
            const textWidth = font.widthOfTextAtSize(anno.text, anno.size);

            let textX = drawX;
            if (anno.align === 'center') textX = drawX + (drawWidth / 2) - (textWidth / 2);
            else if (anno.align === 'right') textX = drawX + drawWidth - textWidth;

            const textY = pageHeight - anno.y - anno.height + (anno.height / 2) - (anno.size / 2.5);

            newPage.drawText(anno.text, {
                x: textX, y: textY,
                font, size: anno.size,
                color: hexToRgb(anno.color),
                maxWidth: drawWidth,
            });
        }
    }
}

// Rasteroi sivu kuvaksi kierron kanssa
async function rasterizePageWithRotation(pageNum, pageAnnotations, rotation) {
    const scale = 2.0;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale, rotation });

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = viewport.width;
    tempCanvas.height = viewport.height;
    const tempCtx = tempCanvas.getContext('2d');

    // Renderöi PDF-sivu canvasille
    await page.render({
        canvasContext: tempCtx,
        viewport: viewport
    }).promise;

    // Piirrä kaikki annotaatiot canvasille
    for (const anno of pageAnnotations) {
        const canvasX = anno.x * scale;
        const canvasY = anno.y * scale;
        const canvasW = anno.width * scale;
        const canvasH = anno.height * scale;

        if (anno.type === 'rect_erase') {
            tempCtx.fillStyle = anno.color;
            tempCtx.fillRect(canvasX, canvasY, canvasW, canvasH);
        }
        else if (anno.type === 'highlight') {
            const color = anno.color;
            const opacity = anno.opacity;
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            tempCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
            tempCtx.fillRect(canvasX, canvasY, canvasW, canvasH);
        }
        else if (anno.type === 'text') {
            tempCtx.textBaseline = 'middle';
            const fontWeight = anno.bold ? 'bold' : 'normal';
            const fontStyle = anno.italic ? 'italic' : 'normal';
            tempCtx.font = `${fontStyle} ${fontWeight} ${anno.size * scale}px ${anno.font}`;
            tempCtx.fillStyle = anno.color;

            let textX = canvasX;
            tempCtx.textAlign = anno.align || 'left';
            if (tempCtx.textAlign === 'center') {
                textX = canvasX + canvasW / 2;
            } else if (tempCtx.textAlign === 'right') {
                textX = canvasX + canvasW;
            }

            const textY = canvasY + canvasH / 2;
            tempCtx.fillText(anno.text, textX, textY, canvasW);
        }
    }

    // Muunna canvas PNG-kuvaksi
    const dataUrl = tempCanvas.toDataURL('image/png');
    const base64Data = dataUrl.split(',')[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
}

function hexToRgb(hex) {
    if (!hex) return PDFLib.rgb(0, 0, 0);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
        const r = parseInt(result[1], 16) / 255;
        const g = parseInt(result[2], 16) / 255;
        const b = parseInt(result[3], 16) / 255;
        return PDFLib.rgb(r, g, b);
    }
    return PDFLib.rgb(0, 0, 0);
}


// === TAPAHTUMANKÄSITTELIJÄT ===
openBtn.addEventListener('click', () => pdfUpload.click());
pdfUpload.addEventListener('change', (event) => { if (event.target.files[0]) loadPdf(event.target.files[0]); });
prevPageBtn.addEventListener('click', () => { if(currentPageIndex > 0) renderPage(currentPageIndex - 1); });
nextPageBtn.addEventListener('click', () => { if(currentPageIndex < totalPages - 1) renderPage(currentPageIndex + 1); });
zoomInBtn.addEventListener('click', () => { if(zoomLevel < 4.0) { zoomLevel += 0.2; renderPage(currentPageIndex); } });
zoomOutBtn.addEventListener('click', () => { if(zoomLevel > 0.2) { zoomLevel -= 0.2; renderPage(currentPageIndex); } });

canvasContainer.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey) {
        event.deltaY < 0 ? zoomInBtn.click() : zoomOutBtn.click();
        return;
    }
    if (pageChangeDebounce) return;
    pageChangeDebounce = true;
    setTimeout(() => pageChangeDebounce = false, 300);
    if (event.deltaY > 0) {
        if (currentPageIndex < totalPages - 1) {
            renderPage(currentPageIndex + 1);
        }
    } 
    else if (event.deltaY < 0) {
        if (currentPageIndex > 0) {
            renderPage(currentPageIndex - 1);
        }
    }
});

toolButtons.forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));
saveBtn.addEventListener('click', savePdf);
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

pageInput.addEventListener('change', () => {
    let newPageIndex = parseInt(pageInput.value) - 1;
    if (isNaN(newPageIndex) || newPageIndex < 0) newPageIndex = 0;
    if (newPageIndex >= totalPages) newPageIndex = totalPages - 1;
    renderPage(newPageIndex);
});
pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });


// --- HIiren KÄSITTELY ---

canvas.addEventListener('mousedown', (e) => {
    if (!pdfDoc) return;
    const rect = canvas.getBoundingClientRect();
    startCoords = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    
    if (currentTool === 'select') {
        activeHandle = getHandleAtCoords(startCoords.x, startCoords.y);
        if (activeHandle) {
            isResizing = true;
            originalItemForResize = { ...selectedItem, size: selectedItem.size };
            canvasSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
            return;
        }

        const pdfCoords = { x: startCoords.x / zoomLevel, y: startCoords.y / zoomLevel };
        const clickedItem = getItemAtCoords(pdfCoords.x, pdfCoords.y);
        
        if (clickedItem) {
            if (clickedItem !== selectedItem) {
                selectedItem = clickedItem;
                renderPage(currentPageIndex);
            }
            isMoving = true;
            originalItemPos = { x: selectedItem.x, y: selectedItem.y };
            canvasSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } else {
            if (selectedItem) {
                selectedItem = null;
                renderPage(currentPageIndex);
            }
        }
    }
    else if (['text', 'rect_erase', 'highlight'].includes(currentTool)) {
        isDrawing = true;
        canvasSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const currentCanvasCoords = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (currentTool === 'select' && selectedItem && !isMoving && !isResizing) {
        const handle = getHandleAtCoords(currentCanvasCoords.x, currentCanvasCoords.y);
        canvas.style.cursor = handle ? ((handle.includes('n') && handle.includes('w')) || (handle.includes('s') && handle.includes('e')) ? 'nwse-resize' : 'nesw-resize') : 'move';
    } else if (!isMoving && !isResizing) {
        canvas.style.cursor = '';
    }

    if (isResizing) {
        if (canvasSnapshot) ctx.putImageData(canvasSnapshot, 0, 0);

        const newPdfCoords = { x: currentCanvasCoords.x / zoomLevel, y: currentCanvasCoords.y / zoomLevel };
        const orig = originalItemForResize;
        
        let newX = orig.x, newY = orig.y, newW = orig.width, newH = orig.height;
        
        if (activeHandle.includes('e')) newW = newPdfCoords.x - orig.x;
        if (activeHandle.includes('w')) {
            newW = (orig.x + orig.width) - newPdfCoords.x;
            newX = newPdfCoords.x;
        }
        if (activeHandle.includes('s')) newH = newPdfCoords.y - orig.y;
        if (activeHandle.includes('n')) {
            newH = (orig.y + orig.height) - newPdfCoords.y;
            newY = newPdfCoords.y;
        }

        if (newW > 5 && newH > 5) {
            selectedItem.x = newX;
            selectedItem.y = newY;
            selectedItem.width = newW;
            selectedItem.height = newH;
            if (orig.width > 0 && selectedItem.type === 'text') {
                 selectedItem.size = orig.size * (newW / orig.width);
            }
        }
        
        drawSingleAnnotation(selectedItem);
        populatePropertiesPanel();
    }
    else if (isMoving && selectedItem) {
        if (canvasSnapshot) ctx.putImageData(canvasSnapshot, 0, 0);
        
        const deltaX = (currentCanvasCoords.x - startCoords.x) / zoomLevel;
        const deltaY = (currentCanvasCoords.y - startCoords.y) / zoomLevel;

        selectedItem.x = originalItemPos.x + deltaX;
        selectedItem.y = originalItemPos.y + deltaY;
        
        drawSingleAnnotation(selectedItem);
        populatePropertiesPanel();
    }
    else if (isDrawing) {
        if (canvasSnapshot) ctx.putImageData(canvasSnapshot, 0, 0);
        const width = currentCanvasCoords.x - startCoords.x;
        const height = currentCanvasCoords.y - startCoords.y;
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(startCoords.x, startCoords.y, width, height);
        ctx.setLineDash([]);
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (isResizing) {
        isResizing = false;
        activeHandle = null;
        canvasSnapshot = null;
        if (JSON.stringify(originalItemForResize) !== JSON.stringify(selectedItem)) {
            addUndoAction({ action: 'resize', item: selectedItem, from: originalItemForResize, to: { ...selectedItem } });
        }
        renderPage(currentPageIndex);
    }
    else if (isMoving) {
        isMoving = false;
        canvasSnapshot = null;
        if (selectedItem.x !== originalItemPos.x || selectedItem.y !== originalItemPos.y) {
            addUndoAction({
                action: 'move',
                item: selectedItem,
                from: originalItemPos,
                to: { x: selectedItem.x, y: selectedItem.y }
            });
        }
        renderPage(currentPageIndex);
    }
    else if (isDrawing) {
        isDrawing = false;
        canvasSnapshot = null;
        const rect = canvas.getBoundingClientRect();
        const endCoords = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        if (Math.abs(endCoords.x - startCoords.x) < 5) {
            renderPage(currentPageIndex);
            return;
        }

        let newAnnotation = null;
        const pageNum = pageOrder[currentPageIndex];
        if (currentTool === 'text') {
            const text = prompt("Kirjoita teksti:", "");
            if (text) {
                newAnnotation = { type: 'text', text, font: 'Helvetica', size: 12, color: '#000000', bold: false, italic: false, align: 'center' };
            }
        } else if (currentTool === 'rect_erase') {
            newAnnotation = { type: 'rect_erase', color: '#ffffff' };
        } else if (currentTool === 'highlight') {
            newAnnotation = { type: 'highlight', color: '#ffff00', opacity: 0.4 };
        }

        if (newAnnotation) {
            newAnnotation.x = Math.min(startCoords.x, endCoords.x) / zoomLevel;
            newAnnotation.y = Math.min(startCoords.y, endCoords.y) / zoomLevel;
            newAnnotation.width = Math.abs(startCoords.x - endCoords.x) / zoomLevel;
            newAnnotation.height = Math.abs(startCoords.y - endCoords.y) / zoomLevel;
            
            if (!annotations[pageNum]) annotations[pageNum] = [];
            annotations[pageNum].push(newAnnotation);
            addUndoAction({ action: 'add', item: newAnnotation, pageIndex: pageNum });

            selectedItem = newAnnotation;
            setTool('select');
        }
        renderPage(currentPageIndex);
    }
});


// === PANEELIN JA KONTEKSTIVALIKON TAPAHTUMANKÄSITTELIJÄT ===
function handlePropertyChange(changeFn) {
    if (!selectedItem) return;

    const fromState = { ...selectedItem };
    changeFn();
    const toState = { ...selectedItem };
    
    addUndoAction({ action: 'resize', item: selectedItem, from: fromState, to: toState });
    renderPage(currentPageIndex);
}

[propX, propY, propW, propH].forEach(input => {
    input.addEventListener('change', () => {
        handlePropertyChange(() => {
            selectedItem.x = parseFloat(propX.value);
            selectedItem.y = parseFloat(propY.value);
            selectedItem.width = parseFloat(propW.value);
            selectedItem.height = parseFloat(propH.value);
        });
    });
});

[fontSelect, fontSizeInput, colorPicker].forEach(input => {
    input.addEventListener('input', () => {
        if (!selectedItem || selectedItem.type !== 'text') return;
        selectedItem.font = fontSelect.value;
        selectedItem.size = parseFloat(fontSizeInput.value);
        selectedItem.color = colorPicker.value;
        renderPage(currentPageIndex);
    });
    input.addEventListener('change', () => {
        handlePropertyChange(() => {});
    });
});

[boldBtn, italicBtn, ...alignButtons].forEach(btn => {
    btn.addEventListener('click', () => {
        if (!selectedItem || selectedItem.type !== 'text') return;
        handlePropertyChange(() => {
            if (btn.id === 'bold-btn') selectedItem.bold = !selectedItem.bold;
            if (btn.id === 'italic-btn') selectedItem.italic = !selectedItem.italic;
            if (btn.classList.contains('align-btn')) {
                alignButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (btn.id.includes('left')) selectedItem.align = 'left';
                if (btn.id.includes('center')) selectedItem.align = 'center';
                if (btn.id.includes('right')) selectedItem.align = 'right';
            }
        });
    });
});

highlightColorPicker.addEventListener('input', () => {
    if (!selectedItem || selectedItem.type !== 'highlight') return;
    selectedItem.color = highlightColorPicker.value;
    renderPage(currentPageIndex);
});
highlightColorPicker.addEventListener('change', () => handlePropertyChange(() => {}));

highlightOpacitySlider.addEventListener('input', () => {
    if (!selectedItem || selectedItem.type !== 'highlight') return;
    const opacity = parseFloat(highlightOpacitySlider.value);
    selectedItem.opacity = opacity;
    opacityValue.textContent = `${Math.round(opacity * 100)}%`;
    renderPage(currentPageIndex);
});
highlightOpacitySlider.addEventListener('change', () => handlePropertyChange(() => {}));

coverColorPicker.addEventListener('input', () => {
    if (!selectedItem || selectedItem.type !== 'rect_erase') return;
    selectedItem.color = coverColorPicker.value;
    renderPage(currentPageIndex);
});
coverColorPicker.addEventListener('change', () => handlePropertyChange(() => {}));


document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
    }
    else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
    }
    else if (e.key === 'Delete' && selectedItem) {
        deleteSelectedItem();
    }
});

function deleteSelectedItem() {
    if (!selectedItem) return;
    const pageNum = pageOrder[currentPageIndex];
    const pageAnnos = annotations[pageNum] || [];
    const index = pageAnnos.findIndex(a => a === selectedItem);
    if (index > -1) {
        const itemToDelete = pageAnnos[index];
        addUndoAction({ action: 'delete', item: itemToDelete, originalIndex: index, pageIndex: pageNum });
        pageAnnos.splice(index, 1);
        selectedItem = null;
        renderPage(currentPageIndex);
    }
}

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    hideContextMenu();
    hidePageContextMenu();

    const pdfCoords = { x: startCoords.x / zoomLevel, y: startCoords.y / zoomLevel };
    const item = getItemAtCoords(pdfCoords.x, pdfCoords.y);
    
    if (item) {
        selectedItem = item;
        renderPage(currentPageIndex);

        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.classList.remove('hidden');

        document.getElementById('ctx-delete').onclick = () => {
            deleteSelectedItem();
            hideContextMenu();
        };
        document.getElementById('ctx-bring-front').onclick = () => {
            bringToFront();
            hideContextMenu();
        };
        document.getElementById('ctx-send-back').onclick = () => {
            sendToBack();
            hideContextMenu();
        };
        document.getElementById('ctx-copy').onclick = () => {
            duplicateSelectedItem();
            hideContextMenu();
        };
    }
});

function hideContextMenu() {
    contextMenu.classList.add('hidden');
}
function hidePageContextMenu() {
    pageContextMenu.classList.add('hidden');
}
window.addEventListener('click', () => {
    hideContextMenu();
    hidePageContextMenu();
});

function duplicateSelectedItem() {
    if (!selectedItem) return;
    const newItem = JSON.parse(JSON.stringify(selectedItem));
    newItem.x += 10;
    newItem.y += 10;

    const pageNum = pageOrder[currentPageIndex];
    if (!annotations[pageNum]) {
        annotations[pageNum] = [];
    }
    annotations[pageNum].push(newItem);
    addUndoAction({ action: 'add', item: newItem, pageIndex: pageNum });
    selectedItem = newItem;
    renderPage(currentPageIndex);
}

function bringToFront() {
    if (!selectedItem) return;
    const pageNum = pageOrder[currentPageIndex];
    const pageAnnos = annotations[pageNum] || [];
    const index = pageAnnos.findIndex(a => a === selectedItem);
    if (index > -1 && index < pageAnnos.length - 1) {
        const item = pageAnnos.splice(index, 1)[0];
        pageAnnos.push(item);
        addUndoAction({ action: 'order', item: selectedItem, from: { ...selectedItem }, to: { ...selectedItem } });
        renderPage(currentPageIndex);
    }
}

function sendToBack() {
    if (!selectedItem) return;
    const pageNum = pageOrder[currentPageIndex];
    const pageAnnos = annotations[pageNum] || [];
    const index = pageAnnos.findIndex(a => a === selectedItem);
    if (index > 0) {
        const item = pageAnnos.splice(index, 1)[0];
        pageAnnos.unshift(item);
        addUndoAction({ action: 'order', item: selectedItem, from: { ...selectedItem }, to: { ...selectedItem } });
        renderPage(currentPageIndex);
    }
}


// === RAHAUS- JA PUDOTUSTOIMINNOT ===

let draggedItem = null;
let dropTargetIndex = -1;

function clearDropIndicators() {
    document.querySelectorAll('.thumbnail-item.drop-above, .thumbnail-item.drop-below').forEach(el => {
        el.classList.remove('drop-above', 'drop-below');
    });
}

function addDragAndDropListeners() {
    const thumbnails = document.querySelectorAll('.thumbnail-item');

    thumbnails.forEach(thumb => {
        thumb.addEventListener('dragstart', (e) => {
            draggedItem = thumb;
            dropTargetIndex = -1;
            setTimeout(() => thumb.classList.add('dragging'), 0);
        });

        thumb.addEventListener('dragend', (e) => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
            }
            draggedItem = null;
            dropTargetIndex = -1;
            clearDropIndicators();
        });

        thumb.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!draggedItem || draggedItem === thumb) return;

            // Poista aiemmat indikaattorit
            clearDropIndicators();

            // Määritä onko hiiri elementin ylä- vai alapuoliskolla
            const rect = thumb.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const thumbIndex = parseInt(thumb.dataset.pageIndex);

            if (e.clientY < midY) {
                // Pudotetaan tämän elementin yläpuolelle
                thumb.classList.add('drop-above');
                dropTargetIndex = thumbIndex;
            } else {
                // Pudotetaan tämän elementin alapuolelle
                thumb.classList.add('drop-below');
                dropTargetIndex = thumbIndex + 1;
            }
        });

        thumb.addEventListener('dragleave', (e) => {
            // Älä poista indikaattoreita jos siirrytään lapsielementtiin
            if (e.relatedTarget && thumb.contains(e.relatedTarget)) return;
            thumb.classList.remove('drop-above', 'drop-below');
        });

        thumb.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!draggedItem) return;

            const fromIndex = parseInt(draggedItem.dataset.pageIndex);
            let toIndex = dropTargetIndex;

            // Jos dropTargetIndex ei ole asetettu, laske thumbin sijainnista
            if (toIndex < 0) {
                const rect = thumb.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const thumbIndex = parseInt(thumb.dataset.pageIndex);
                toIndex = e.clientY < midY ? thumbIndex : thumbIndex + 1;
            }

            // Korjaa indeksi jos siirretään alaspäin
            if (fromIndex < toIndex) {
                toIndex--;
            }

            // Varmista että indeksi on järkevä
            if (toIndex < 0) toIndex = 0;
            if (toIndex > pageOrder.length - 1) toIndex = pageOrder.length - 1;

            // Älä tee mitään jos järjestys ei muutu
            if (fromIndex !== toIndex) {
                const originalOrder = [...pageOrder];

                const [movedPage] = pageOrder.splice(fromIndex, 1);
                pageOrder.splice(toIndex, 0, movedPage);

                addUndoAction({ action: 'order', from: originalOrder, to: [...pageOrder] });

                renderThumbnails();
            }

            clearDropIndicators();
            draggedItem = null;
            dropTargetIndex = -1;
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.thumbnail-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function deletePage(pageIndexToDelete) {
    if (totalPages <= 1) {
        alert("Et voi poistaa viimeistä sivua.");
        return;
    }
    const originalOrder = [...pageOrder];
    pageOrder.splice(pageIndexToDelete, 1);
    totalPages--;

    addUndoAction({ action: 'delete_page', from: originalOrder, to: [...pageOrder] });

    if (currentPageIndex >= pageIndexToDelete && currentPageIndex > 0) {
        currentPageIndex--;
    }

    renderThumbnails();
    renderPage(currentPageIndex);
}


// === SIVUJEN KIERTO JA LISÄYS ===

let blankPageCounter = -1; // Uniikki tunniste tyhjille sivuille

function rotatePage(pageIndex, degrees) {
    const pageNum = pageOrder[pageIndex];

    // Tyhjien sivujen kiertoa ei tueta (ei ole mitään kierrettävää)
    if (pageNum < 0) {
        return;
    }

    // Hae nykyinen kierto tai käytä 0
    const currentRotation = pageRotations[pageNum] || 0;
    // Laske uusi kierto (normalisoi 0-360)
    let newRotation = (currentRotation + degrees) % 360;
    if (newRotation < 0) newRotation += 360;

    // Tallenna kiertotieto
    pageRotations[pageNum] = newRotation;

    // Renderöi sivu ja päivitä pikkukuva
    renderPage(pageIndex);
    updateThumbnail(pageIndex);
}

async function updateThumbnail(pageIndex) {
    const pageNum = pageOrder[pageIndex];
    const thumbnails = document.querySelectorAll('.thumbnail-item');
    const thumbContainer = thumbnails[pageIndex];

    if (!thumbContainer) return;

    const thumbCanvas = thumbContainer.querySelector('canvas');
    if (!thumbCanvas) return;

    // Tyhjä sivu - piirrä valkoinen
    if (pageNum < 0) {
        const thumbCtx = thumbCanvas.getContext('2d');
        thumbCtx.fillStyle = 'white';
        thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
        return;
    }

    const page = await pdfDoc.getPage(pageNum);
    const rotation = pageRotations[pageNum] || 0;
    const viewport = page.getViewport({ scale: 1.0, rotation: rotation });
    const scale = 150 / Math.max(viewport.width, viewport.height);
    const scaledViewport = page.getViewport({ scale, rotation });

    thumbCanvas.width = scaledViewport.width;
    thumbCanvas.height = scaledViewport.height;
    const thumbCtx = thumbCanvas.getContext('2d');

    await page.render({
        canvasContext: thumbCtx,
        viewport: scaledViewport
    }).promise;
}

function addBlankPage(afterIndex) {
    // Luo uniikki negatiivinen tunniste tyhjälle sivulle
    const blankPageId = blankPageCounter;
    blankPageCounter--;

    // Tallenna tyhjän sivun tiedot
    blankPages.push(blankPageId);

    const originalOrder = [...pageOrder];

    // Lisää tyhjä sivu pageOrder-taulukkoon afterIndex-kohdan jälkeen
    pageOrder.splice(afterIndex + 1, 0, blankPageId);
    totalPages++;

    addUndoAction({ action: 'add_page', from: originalOrder, to: [...pageOrder], blankPageId: blankPageId });

    // Renderöi pikkukuvat uudelleen ja näytä uusi sivu
    renderThumbnails();
    renderPage(afterIndex + 1);
}


// Alustus
updateUi();

const styleSheet = document.createElement("style");
styleSheet.innerText = `
    .crosshair-cursor { cursor: crosshair; }
`;
document.head.appendChild(styleSheet);
