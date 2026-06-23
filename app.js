import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const PAGE_RENDER_NEIGHBORS = 2;
const PAGE_OBSERVER_MARGIN = "900px 0px";
const PDF_LOAD_OPTIONS = {
  disableFontFace: true,
  useSystemFonts: false
};

const state = {
  pdf: null,
  file: null,
  fileBytes: null,
  fingerprint: "",
  pageCount: 0,
  currentPage: 1,
  scale: 1.25,
  mode: "continuous",
  fit: "width",
  tool: "pan",
  meta: emptyMeta(),
  renderedPages: new Map(),
  pageShells: [],
  pageObserver: null,
  pageRenderQueue: [],
  isProcessingPageQueue: false,
  activePageRenderTask: null,
  activePageNo: null,
  search: { term: "", hits: [], index: -1 },
  drawing: null,
  panning: null,
  renderId: 0,
  isRendering: false,
  isAdjustingScroll: false,
  scrollLockId: 0,
  pageWheelDelta: 0,
  pageWheelLockedUntil: 0,
  isSinglePageWheelActive: false,
  selectedFieldId: null,
  signatureSessionId: null,
  screenshotSelection: {
    active: false,
    dragging: false,
    pointerId: null,
    pageNo: null,
    box: null,
    rect: null,
    startX: 0,
    startY: 0
  },
  printMode: "document",
  profile: loadProfile(),
  installPrompt: null,
  spacePressed: false,
  suppressContextMenu: false,
  insertMenuPlacement: null
};

function emptyMeta() {
  return {
    bookmarks: [],
    highlights: [],
    fields: [],
    signatures: [],
    readingPosition: 1,
    readingOffset: 0,
    savedReadingPosition: null,
    savedReadingOffset: 0,
    updatedAt: Date.now()
  };
}

const ui = {
  fileInput: $("fileInput"),
  fileName: $("fileName"),
  dropZone: $("dropZone"),
  pages: $("pages"),
  reader: $("reader"),
  emptyState: $("emptyState"),
  pageInput: $("pageInput"),
  pageTotal: $("pageTotal"),
  pageSlider: $("pageSlider"),
  bookmarkList: $("bookmarkList"),
  searchInput: $("searchInput"),
  searchCase: $("searchCase"),
  searchWhole: $("searchWhole"),
  searchCount: $("searchCount"),
  zoomLabel: $("zoomLabel"),
  sidebar: $("sidebar"),
  helpDialog: $("helpDialog"),
  savedSignatureList: $("savedSignatureList"),
  statusMessage: $("statusMessage"),
  screenshotBtn: $("screenshotBtn"),
  screenshotMenu: $("screenshotMenu"),
  selectionActionMenu: $("selectionActionMenu"),
  insertActionMenu: $("insertActionMenu"),
  printBtn: $("printBtn"),
  printMenu: $("printMenu"),
  printDialog: $("printDialog")
};

const saveScrollMeta = debounce(() => saveMeta(false), 200);

wireEvents();
initProfileControls();
registerPwa();
initFileHandling();
updateStatus();

function wireEvents() {
  ui.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file && isPdfFile(file)) openFile(file);
  });

  ["dragenter", "dragover"].forEach((name) => {
    ui.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      ui.dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    ui.dropZone.addEventListener(name, () => ui.dropZone.classList.remove("dragover"));
  });

  ui.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    const [file] = event.dataTransfer.files;
    if (file && isPdfFile(file)) openFile(file);
  });

  $("firstPage").addEventListener("click", () => goToPage(1));
  $("lastPage").addEventListener("click", () => goToPage(state.pageCount));
  ui.pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") goToPage(Number(ui.pageInput.value));
  });
  ui.pageSlider.addEventListener("input", () => {
    ui.pageInput.value = ui.pageSlider.value;
  });
  ui.pageSlider.addEventListener("change", () => {
    goToPage(Number(ui.pageSlider.value));
  });

  $("zoomIn").addEventListener("click", () => setScale(state.scale + 0.15));
  $("zoomOut").addEventListener("click", () => setScale(state.scale - 0.15));
  $("fitWidth").addEventListener("click", () => fitTo("width"));
  $("fitPage").addEventListener("click", () => fitTo("page"));
  $("fullscreenBtn").addEventListener("click", () => document.documentElement.requestFullscreen?.());
  $("toggleSidebar").addEventListener("click", () => {
    ui.sidebar.classList.toggle("collapsed");
    document.querySelector(".app-shell").classList.toggle("sidebar-closed", ui.sidebar.classList.contains("collapsed"));
  });

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll("[data-mode]").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      state.mode = button.dataset.mode;
      syncSinglePageWheel();
      normalizeBookStart();
      if (state.mode.startsWith("book")) {
        await fitTo("width");
      } else {
        render();
      }
    });
  });

  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTool = button.dataset.tool;
      const wasSignatureTool = state.tool === "signature";
      document.querySelectorAll("[data-tool]").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      state.tool = nextTool;
      stopScreenshotSelection();
      if (state.tool === "signature" && !wasSignatureTool) {
        state.signatureSessionId = crypto.randomUUID();
      } else if (state.tool !== "signature") {
        removeEmptySignatureDraft(state.signatureSessionId);
        state.signatureSessionId = null;
      }
      updateToolLayers();
      renderVisibleAnnotations();
      renderSavedSignatures();
    });
  });

  $("addBookmark").addEventListener("click", addBookmark);
  $("savePosition").addEventListener("click", savePosition);
  $("restorePosition").addEventListener("click", restorePosition);
  $("installHelp").addEventListener("click", installOrShowHelp);
  $("closeHelp").addEventListener("click", () => ui.helpDialog.close());

  $("searchBtn").addEventListener("click", search);
  ui.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (state.search.term === ui.searchInput.value.trim() && state.search.hits.length) {
        moveSearch(event.shiftKey ? -1 : 1);
      } else {
        search();
      }
    }
  });
  ui.searchCase.addEventListener("change", search);
  ui.searchWhole.addEventListener("change", search);
  $("nextResult").addEventListener("click", () => moveSearch(1));
  $("prevResult").addEventListener("click", () => moveSearch(-1));

  ui.screenshotBtn.addEventListener("click", toggleScreenshotMenu);
  $("screenshotPageBtn").addEventListener("click", () => {
    closeScreenshotMenu();
    stopScreenshotSelection();
    takeScreenshot();
  });
  $("saveSelectionShot").addEventListener("click", () => saveSelectionScreenshot());
  $("copySelectionShot").addEventListener("click", () => copySelectionScreenshot());
  $("printSelectionStickers").addEventListener("click", () => openPrintDialog("document", "selection"));
  ui.insertActionMenu?.querySelectorAll("[data-insert-action]").forEach((button) => {
    button.addEventListener("click", () => runInsertAction(button.dataset.insertAction));
  });
  ui.printBtn.addEventListener("click", togglePrintMenu);
  $("quickPrintBtn").addEventListener("click", () => {
    closePrintMenu();
    runPrint({ mode: "document", scope: "current", perSheet: 1, orientation: "portrait", cutGuides: false });
  });
  $("printSelectAreaBtn").addEventListener("click", () => {
    closePrintMenu();
    startScreenshotSelection();
  });
  $("printOptionsBtn").addEventListener("click", () => {
    closePrintMenu();
    openPrintDialog();
  });
  $("closePrint").addEventListener("click", closePrintDialog);
  $("cancelPrint").addEventListener("click", closePrintDialog);
  $("printForm").addEventListener("submit", submitPrintOptions);
  document.querySelectorAll("[data-print-mode]").forEach((button) => {
    button.addEventListener("click", () => setPrintMode(button.dataset.printMode));
  });
  $("printForm").addEventListener("input", updatePrintSummary);
  $("printForm").addEventListener("change", updatePrintSummary);
  $("downloadBtn").addEventListener("click", exportPdf);
  $("clearAnnotationsBtn").addEventListener("click", clearAllAnnotations);

  document.querySelectorAll("[data-fill]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => applyQuickFill(button.dataset.fill));
  });

  ui.reader.addEventListener("scroll", onScroll, { passive: true });
  syncSinglePageWheel();
  ui.reader.addEventListener("pointerdown", startReaderPan);
  ui.reader.addEventListener("pointermove", moveReaderPan);
  ui.reader.addEventListener("pointerup", stopReaderPan);
  ui.reader.addEventListener("pointercancel", stopReaderPan);
  ui.reader.addEventListener("contextmenu", (event) => {
    if (state.suppressContextMenu) {
      event.preventDefault();
      state.suppressContextMenu = false;
      return;
    }
    showInsertActionMenu(event);
  });
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openPrintDialog();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state.selectedFieldId && !isTypingTarget(event.target)) {
      deleteSelectedField();
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && ui.helpDialog.open) {
      ui.helpDialog.close();
      announce("חלון ההתקנה נסגר.");
      return;
    }
    if (event.key === "Escape" && state.screenshotSelection.active) {
      stopScreenshotSelection();
      announce("בחירת הקטע להדפסה בוטלה.");
      return;
    }
    if (handleSinglePageKey(event)) return;
    if (event.code === "Space" && !isTypingTarget(event.target)) {
      state.spacePressed = true;
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") state.spacePressed = false;
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#screenshotDropdown")) closeScreenshotMenu();
    if (!event.target.closest("#printDropdown")) closePrintMenu();
    if (!event.target.closest("#selectionActionMenu") && !event.target.closest(".screenshot-layer")) {
      hideSelectionActionMenu();
    }
    if (!event.target.closest("#insertActionMenu")) hideInsertActionMenu();
    if (!event.target.closest(".field-box")) closeFieldMenus();
  });
  window.addEventListener("resize", debounce(() => fitTo(state.fit), 150));
}

function registerPwa() {
  const canUsePwaFeatures = ["http:", "https:"].includes(window.location.protocol);

  if (canUsePwaFeatures && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.warn("Service worker registration failed:", error);
        announce("התקנת השירות האופי לא הצליחה. האפליקציה עדיין תעבוד, אך ללא מטמון מלא.");
      });
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    const installButton = $("installHelp");
    installButton?.classList.add("install-ready");
    const label = installButton?.querySelector("span:last-child");
    if (label) label.textContent = "התקן כאפליקציה";
    announce("האפליקציה מוכנה להתקנה. לחץ על התקן כאפליקציה.");
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    const installButton = $("installHelp");
    installButton?.classList.remove("install-ready");
    const label = installButton?.querySelector("span:last-child");
    if (label) label.textContent = "האפליקציה מותקנת";
    announce("האפליקציה הותקנה בהצלחה. ניתן לפתוח קבצי PDF ישירות ממערכת הקבצים.");
  });
}

async function installOrShowHelp() {
  if (!state.installPrompt) {
    ui.helpDialog.showModal();
    announce("אין כרגע אפשרות התקנה אוטומטית. ראה הסבר נוסף.");
    return;
  }

  const promptEvent = state.installPrompt;
  state.installPrompt = null;
  promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  if (choice.outcome === "accepted") {
    announce("התקנת האפליקציה החלה. המתן לאישור בדפדפן.");
  } else {
    announce("המשתמש ביטל את ההתקנה. ניתן לנסות שוב דרך הכפתור.");
  }
}

function initFileHandling() {
  if (!("launchQueue" in window)) return;

  window.launchQueue.setConsumer((launchParams) => {
    const [fileHandle] = launchParams.files || [];
    if (fileHandle) openFileFromHandle(fileHandle);
  });
}

async function openFileFromHandle(fileHandle) {
  try {
    const file = await fileHandle.getFile();
    if (isPdfFile(file)) await openFile(file);
  } catch (error) {
    console.warn("Could not open launched file:", error);
  }
}

function isPdfFile(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

async function openFile(file) {
  stopScreenshotSelection();
  state.file = file;
  state.fileBytes = await file.arrayBuffer();
  state.pdf = await pdfjsLib.getDocument({
    data: state.fileBytes.slice(0),
    ...PDF_LOAD_OPTIONS
  }).promise;
  state.pageCount = state.pdf.numPages;
  state.fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
  state.meta = loadMeta();
  state.currentPage = clamp(state.meta.readingPosition || 1, 1, state.pageCount);
  state.search = { term: "", hits: [], index: -1 };
  state.renderedPages.clear();
  ui.fileName.textContent = file.name;
  ui.emptyState.hidden = true;
  await fitTo("width");
  renderBookmarks();
}

async function render() {
  if (!state.pdf) return;
  const renderId = ++state.renderId;
  const scrollLockId = lockScrollTracking();
  state.isRendering = true;
  state.pageRenderQueue = [];
  state.renderedPages.clear();
  state.pageShells = [];
  disconnectPageObserver();
  ui.pages.innerHTML = "";
  updateStatus();

  const fragment = document.createDocumentFragment();
  if (state.mode === "continuous" || state.mode === "single") {
    for (let pageNo = 1; pageNo <= state.pageCount; pageNo += 1) {
      if (renderId !== state.renderId) return;
      const pageElement = await createPage(pageNo);
      if (renderId !== state.renderId) return;
      fragment.append(pageElement);
    }
  } else {
    for (const spreadPages of getBookSpreads()) {
      const spread = document.createElement("div");
      spread.className = state.mode === "book-rtl" ? "spread spread-rtl" : "spread spread-ltr";
      for (const pageNo of spreadPages) {
        if (renderId !== state.renderId) return;
        const pageElement = await createPage(pageNo);
        if (renderId !== state.renderId) return;
        spread.append(pageElement);
      }
      fragment.append(spread);
    }
  }
  ui.pages.append(fragment);

  if (renderId !== state.renderId) return;
  paintSearchHits();
  updateToolLayers();
  scrollCurrentIntoView(scrollLockId);
  observePages(renderId);
  queueNearbyContent(state.currentPage, renderId);
}

function createPage(pageNo) {
  const viewport = getFallbackViewport();
  const shell = document.createElement("section");
  shell.className = "page-shell";
  shell.dataset.page = String(pageNo);
  shell.style.width = `${viewport.width}px`;
  shell.style.height = `${viewport.height}px`;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  shell.append(canvas);

  const textLayer = document.createElement("div");
  textLayer.className = "text-layer";
  shell.append(textLayer);

  const searchLayer = document.createElement("div");
  searchLayer.className = "search-layer";
  shell.append(searchLayer);

  const annotationLayer = document.createElement("div");
  annotationLayer.className = "annotation-layer";
  shell.append(annotationLayer);
  wireAnnotationLayer(annotationLayer, pageNo);

  const objectLayer = document.createElement("div");
  objectLayer.className = "object-layer";
  shell.append(objectLayer);

  const screenshotLayer = document.createElement("div");
  screenshotLayer.className = "screenshot-layer";
  shell.append(screenshotLayer);
  wireScreenshotLayer(screenshotLayer, pageNo);

  state.renderedPages.set(pageNo, {
    shell,
    page: null,
    viewport,
    canvas,
    textLayer,
    annotationLayer,
    objectLayer,
    screenshotLayer,
    searchLayer,
    contentRendered: false,
    contentRendering: false
  });
  state.pageShells[pageNo - 1] = shell;
  renderAnnotationsForPage(pageNo);
  return shell;
}

function getFallbackViewport() {
  const width = 612 * state.scale;
  const height = 792 * state.scale;
  return { width, height, scale: state.scale };
}

function queuePageContent(pageNo, renderId, priority = false) {
  const record = state.renderedPages.get(pageNo);
  if (!record || record.contentRendered || record.contentRendering) return;
  state.pageRenderQueue = state.pageRenderQueue.filter((item) => item.pageNo !== pageNo);
  const item = { pageNo, renderId };
  if (priority) {
    state.pageRenderQueue.unshift(item);
  } else {
    state.pageRenderQueue.push(item);
  }
  processPageRenderQueue();
}

function queueNearbyContent(pageNo, renderId) {
  const current = clamp(pageNo || state.currentPage || 1, 1, state.pageCount || 1);
  const pages = [current];
  for (let distance = 1; distance <= PAGE_RENDER_NEIGHBORS; distance += 1) {
    const before = current - distance;
    const after = current + distance;
    if (before >= 1) pages.push(before);
    if (after <= state.pageCount) pages.push(after);
  }
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    queuePageContent(pages[index], renderId, true);
  }
}

function queueDocumentContent(renderId) {
  const current = clamp(state.currentPage || 1, 1, state.pageCount || 1);
  queuePageContent(current, renderId, true);
  for (let distance = 1; distance <= state.pageCount; distance += 1) {
    const before = current - distance;
    const after = current + distance;
    if (before >= 1) queuePageContent(before, renderId);
    if (after <= state.pageCount) queuePageContent(after, renderId);
  }
}

function cancelActivePageRender(nextPageNo) {
  if (!state.activePageRenderTask || state.activePageNo === nextPageNo) return;
  state.activePageRenderTask.cancel?.();
}

function observePages(renderId) {
  if (!("IntersectionObserver" in window)) {
    queueDocumentContent(renderId);
    return;
  }

  state.pageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      queueNearbyContent(Number(entry.target.dataset.page), renderId);
    }
  }, {
    root: ui.reader,
    rootMargin: PAGE_OBSERVER_MARGIN,
    threshold: 0.01
  });

  for (const shell of state.pageShells) {
    if (shell) state.pageObserver.observe(shell);
  }
}

function disconnectPageObserver() {
  state.pageObserver?.disconnect();
  state.pageObserver = null;
}

async function processPageRenderQueue() {
  if (state.isProcessingPageQueue) return;
  state.isProcessingPageQueue = true;
  try {
    while (state.pageRenderQueue.length) {
      const { pageNo, renderId } = state.pageRenderQueue.shift();
      if (renderId !== state.renderId) continue;
      try {
        await renderPageContent(pageNo, renderId);
      } catch (error) {
        if (error?.name === "RenderingCancelledException") continue;
        console.warn(`Could not render page ${pageNo}:`, error);
      }
    }
  } finally {
    state.isProcessingPageQueue = false;
  }
}

async function renderPageContent(pageNo, renderId) {
  const record = state.renderedPages.get(pageNo);
  if (!record || record.contentRendered || record.contentRendering) return;
  record.contentRendering = true;
  try {
    const page = await state.pdf.getPage(pageNo);
    if (renderId !== state.renderId) return;
    const viewport = page.getViewport({ scale: state.scale });
    record.page = page;
    record.viewport = viewport;
    record.shell.style.width = `${viewport.width}px`;
    record.shell.style.height = `${viewport.height}px`;
    record.canvas.width = Math.ceil(viewport.width);
    record.canvas.height = Math.ceil(viewport.height);
    record.canvas.style.width = `${viewport.width}px`;
    record.canvas.style.height = `${viewport.height}px`;
    record.textLayer.style.setProperty("--scale-factor", viewport.scale);
    renderAnnotationsForPage(pageNo);
    const renderTask = page.render({ canvasContext: record.canvas.getContext("2d"), viewport });
    state.activePageRenderTask = renderTask;
    state.activePageNo = pageNo;
    await renderTask.promise;
    if (renderId !== state.renderId) return;
    await renderTextLayer(page, viewport, record.textLayer, pageNo);
    record.contentRendered = true;
    paintSearchHits();
    if (pageNo === state.currentPage) {
      scrollCurrentIntoView();
    }
  } finally {
    if (state.activePageNo === pageNo) {
      state.activePageRenderTask = null;
      state.activePageNo = null;
    }
    record.contentRendering = false;
  }
}

async function renderTextLayer(page, viewport, layer, pageNo) {
  layer.innerHTML = "";
  const content = await page.getTextContent();
  if (pdfjsLib.TextLayer) {
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: content,
      container: layer,
      viewport
    });
    await textLayer.render();
  }
  const record = state.renderedPages.get(pageNo) || {};
  record.text = content.items.map((item) => item.str).join(" ");
  state.renderedPages.set(pageNo, record);
}

function wireAnnotationLayer(layer, pageNo) {
  layer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".field-box")) return;
    if (state.tool === "text") {
      addTextField(pageNo, event.offsetX, event.offsetY);
      return;
    }
    if (state.tool !== "highlight" && state.tool !== "signature") return;
    layer.setPointerCapture(event.pointerId);
    state.drawing = {
      pageNo,
      startX: event.offsetX,
      startY: event.offsetY,
      points: [[event.offsetX, event.offsetY]],
      lastX: event.offsetX,
      lastY: event.offsetY,
      strokeWidth: 1.8,
      preview: document.createElement(state.tool === "signature" ? "svg" : "div")
    };
    state.drawing.preview.className = state.tool === "signature" ? "ink-box" : "highlight-box";
    if (state.tool === "signature") {
      state.drawing.preview.setAttribute("width", "100%");
      state.drawing.preview.setAttribute("height", "100%");
      state.drawing.preview.setAttribute("viewBox", `0 0 ${layer.clientWidth} ${layer.clientHeight}`);
      state.drawing.line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      state.drawing.line.setAttribute("fill", "none");
      state.drawing.line.setAttribute("stroke", "#111827");
      state.drawing.line.setAttribute("stroke-width", String(state.drawing.strokeWidth));
      state.drawing.line.setAttribute("stroke-linecap", "round");
      state.drawing.line.setAttribute("stroke-linejoin", "round");
      state.drawing.preview.append(state.drawing.line);
    }
    layer.append(state.drawing.preview);
  });

  layer.addEventListener("pointermove", (event) => {
    if (!state.drawing) return;
    if (state.tool === "signature") event.preventDefault();
    const x = event.offsetX;
    const y = event.offsetY;
    if (state.tool === "signature") {
      const distance = Math.hypot(x - state.drawing.lastX, y - state.drawing.lastY);
      if (distance < 1.4) return;
      state.drawing.points.push([x, y]);
      state.drawing.lastX = x;
      state.drawing.lastY = y;
      state.drawing.line.setAttribute("d", pointsToSmoothPath(state.drawing.points));
    } else {
      positionBox(state.drawing.preview, state.drawing.startX, state.drawing.startY, x, y);
    }
  });

  layer.addEventListener("pointerup", finishDrawing);
  layer.addEventListener("pointercancel", () => {
    state.drawing?.preview.remove();
    state.drawing = null;
  });
}

function finishDrawing(event) {
  if (!state.drawing) return;
  const record = state.renderedPages.get(state.drawing.pageNo);
  const width = record.viewport.width;
  const height = record.viewport.height;
  if (state.tool === "highlight") {
    const box = normalizedBox(state.drawing.startX, state.drawing.startY, event.offsetX, event.offsetY, width, height);
    state.drawing.preview.remove();
    if (box.w > 0.01 && box.h > 0.005) {
      state.meta.highlights.push({ id: crypto.randomUUID(), page: state.drawing.pageNo, ...box });
    }
  } else if (state.tool === "signature") {
    const points = state.drawing.points.map(([x, y]) => [x / width, y / height]);
    state.drawing.preview.remove();
    if (points.length > 2) {
      const signature = getActiveSignature(state.drawing.pageNo);
      getSignatureStrokes(signature).push(points);
      delete signature.draftBox;
      signature.strokeWidth = state.drawing.strokeWidth / width;
    }
  }
  state.drawing = null;
  saveMeta();
  renderAnnotationsForPage(record.shell.dataset.page);
  renderSavedSignatures();
}

function addTextField(pageNo, x, y) {
  addTextFieldWithValue(pageNo, x, y, "");
}

function addTextFieldWithValue(pageNo, x, y, text, options = {}) {
  const record = state.renderedPages.get(pageNo);
  const id = crypto.randomUUID();
  const field = {
    id,
    page: pageNo,
    x: x / record.viewport.width,
    y: y / record.viewport.height,
    w: options.w || 0.09,
    h: options.h || 0.032,
    fontSize: options.fontSize || 15,
    type: options.type || "text",
    text
  };
  state.meta.fields.push(field);
  state.selectedFieldId = id;
  saveMeta();
  renderAnnotationsForPage(pageNo);
  requestAnimationFrame(() => {
    const content = record.objectLayer.querySelector(`[data-field-id="${CSS.escape(id)}"] .field-content`);
    content?.focus();
    const box = record.objectLayer.querySelector(`[data-field-id="${CSS.escape(id)}"]`);
    if (box && content) autosizeTextField(box, content, field, record);
  });
  return field;
}

function renderAnnotationsForPage(pageNo) {
  pageNo = Number(pageNo);
  const record = state.renderedPages.get(pageNo);
  if (!record) return;
  const layer = record.annotationLayer;
  const objectLayer = record.objectLayer;
  layer.innerHTML = "";
  objectLayer.innerHTML = "";
  const w = record.viewport.width;
  const h = record.viewport.height;

  state.meta.highlights.filter((item) => item.page === pageNo).forEach((item) => {
    const box = document.createElement("div");
    box.className = "highlight-box movable-annotation";
    setNormRect(box, item, w, h);
    box.title = "גרור להזזה";
    wireRectAnnotationDrag(box, item, record);
    box.append(createAnnotationControls({
      label: "הדגשה",
      compact: true,
      onDelete: () => removeAnnotation("highlights", item.id, pageNo)
    }));
    layer.append(box);
  });

  state.meta.fields.filter((item) => item.page === pageNo).forEach((item) => {
    const field = document.createElement("div");
    field.className = "field-box";
    field.classList.toggle("note-field", item.type === "note");
    field.dataset.fieldId = item.id;
    field.addEventListener("pointerdown", (event) => {
      state.selectedFieldId = item.id;
      markSelectedField(pageNo);
      event.stopPropagation();
    });
    field.classList.toggle("selected", state.selectedFieldId === item.id);
    setNormRect(field, item, w, h);

    const content = document.createElement("div");
    content.className = "field-content";
    content.contentEditable = "true";
    content.dir = "auto";
    content.style.fontSize = `${getFieldFontSize(item)}px`;
    content.textContent = item.text;
    content.addEventListener("input", () => {
      item.text = content.textContent;
      autosizeTextField(field, content, item, record);
    });
    content.addEventListener("blur", () => {
      if (!content.textContent.trim()) {
        removeAnnotation("fields", item.id, pageNo);
      }
    });
    content.addEventListener("pointerdown", (event) => {
      state.selectedFieldId = item.id;
      markSelectedField(pageNo);
      event.stopPropagation();
    });

    const menuButton = document.createElement("button");
    menuButton.className = "field-menu-button";
    menuButton.type = "button";
    menuButton.textContent = "⋯";
    menuButton.title = item.type === "note" ? "אפשרויות הערה" : "אפשרויות טקסט";
    menuButton.setAttribute("aria-label", item.type === "note" ? "אפשרויות הערה" : "אפשרויות טקסט");
    menuButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    menuButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.selectedFieldId = item.id;
      markSelectedField(pageNo);
      field.classList.toggle("menu-open");
    });

    const menu = document.createElement("div");
    menu.className = "field-menu";
    menu.setAttribute("role", "menu");

    const handle = createFieldMenuButton("↕", "הזז", "גרור כדי להזיז");
    handle.classList.add("field-drag-action");
    handle.addEventListener("pointerdown", (event) => {
      state.selectedFieldId = item.id;
      markSelectedField(pageNo);
      event.stopPropagation();
    });

    const smaller = createFieldMenuButton("A−", "הקטן", "הקטן טקסט");
    smaller.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      changeFieldFontSize(item, field, content, record, -1);
    });

    const larger = createFieldMenuButton("A+", "הגדל", "הגדל טקסט");
    larger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      changeFieldFontSize(item, field, content, record, 1);
    });

    const fill = createFieldFillMenu(item, field, content, record);

    const del = createFieldMenuButton("×", "מחק", "מחק שדה");
    del.classList.add("danger");
    del.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeAnnotation("fields", item.id, pageNo);
    });

    menu.append(handle, smaller, larger, fill, del);

    wireFieldDrag(handle, field, item, record);
    field.append(menuButton, menu, content);
    objectLayer.append(field);
    requestAnimationFrame(() => autosizeTextField(field, content, item, record, false));
  });

  state.meta.signatures.filter((item) => item.page === pageNo).forEach((item) => {
    const strokes = getSignatureStrokes(item).filter((stroke) => stroke.length > 1);
    const isActiveSignature = state.tool === "signature" && item.sessionId === state.signatureSessionId;
    if (!strokes.length && !isActiveSignature) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ink-box");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.inset = "0";
    const paths = strokes.map((stroke) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#111827");
      path.setAttribute("stroke-width", String(getSignatureStrokeWidth(item, w)));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("d", pointsToSmoothPath(stroke.map(([x, y]) => [x * w, y * h])));
      svg.append(path);
      return path;
    });
    layer.append(svg);

    const box = document.createElement("div");
    box.className = "signature-move-box movable-annotation";
    box.classList.toggle("signing-pad", isActiveSignature);
    box.title = "גרור להזזה";
    setSignatureMoveBox(box, item, w, h, isActiveSignature);
    wireSignatureDrag(box, item, record, paths);
    box.append(createAnnotationControls({
      label: "חתימה",
      onCommit: isActiveSignature ? () => commitActiveSignature() : null,
      onSave: () => saveSignatureToProfile(item),
      onDelete: () => removeAnnotation("signatures", item.id, pageNo)
    }));
    layer.append(box);
  });
}

function removeAnnotation(type, id, pageNo) {
  state.meta[type] = state.meta[type].filter((item) => item.id !== id);
  if (type === "fields" && state.selectedFieldId === id) state.selectedFieldId = null;
  saveMeta();
  renderAnnotationsForPage(pageNo);
}

function markSelectedField(pageNo) {
  const record = state.renderedPages.get(Number(pageNo));
  if (!record) return;
  document.querySelectorAll(".field-box").forEach((field) => {
    field.classList.remove("selected");
    if (field.dataset.fieldId !== state.selectedFieldId) field.classList.remove("menu-open");
  });
  if (!state.selectedFieldId) return;
  record.objectLayer.querySelector(`[data-field-id="${CSS.escape(state.selectedFieldId)}"]`)?.classList.add("selected");
}

function deleteSelectedField() {
  const field = state.meta.fields.find((item) => item.id === state.selectedFieldId);
  if (!field) {
    state.selectedFieldId = null;
    return;
  }
  removeAnnotation("fields", field.id, field.page);
}

function createFieldMenuButton(icon, label, title) {
  const button = document.createElement("button");
  button.className = "field-menu-action";
  button.type = "button";
  button.innerHTML = `<span>${icon}</span><small>${label}</small>`;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return button;
}

function createFieldFillMenu(item, field, content, record) {
  const wrap = document.createElement("div");
  wrap.className = "field-fill-menu";

  const trigger = createFieldMenuButton("▾", "מילוי", "מילוי מהיר");
  trigger.classList.add("field-fill-trigger");
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    wrap.classList.toggle("open");
  });

  const list = document.createElement("div");
  list.className = "field-fill-list";
  list.setAttribute("role", "menu");

  [
    ["name", "שם"],
    ["address", "כתובת"],
    ["email", "מייל"],
    ["phone", "טלפון"],
    ["date", "תאריך"],
    ["check", "✓"],
    ["cross", "✕"]
  ].forEach(([type, label]) => {
    const option = document.createElement("button");
    option.type = "button";
    option.textContent = label;
    option.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = getQuickFillValue(type);
      if (!value) return;
      setFieldText(item, value);
      wrap.classList.remove("open");
      field.classList.remove("menu-open");
      content.focus();
    });
    list.append(option);
  });

  wrap.append(trigger, list);
  return wrap;
}

function closeFieldMenus() {
  document.querySelectorAll(".field-box.menu-open").forEach((field) => field.classList.remove("menu-open"));
  document.querySelectorAll(".field-fill-menu.open").forEach((menu) => menu.classList.remove("open"));
}

function clearAllAnnotations() {
  if (!state.pdf) return;
  const count = (state.meta.highlights?.length || 0)
    + (state.meta.fields?.length || 0)
    + (state.meta.signatures?.length || 0);
  if (!count) return;
  if (!confirm(`למחוק את כל ההוספות במסמך הזה? (${count})`)) return;
  state.meta.highlights = [];
  state.meta.fields = [];
  state.meta.signatures = [];
  state.selectedFieldId = null;
  saveMeta();
  for (const pageNo of state.renderedPages.keys()) {
    renderAnnotationsForPage(pageNo);
  }
}

function initProfileControls() {
  const fields = {
    name: $("profileName"),
    address: $("profileAddress"),
    email: $("profileEmail"),
    phone: $("profilePhone")
  };

  Object.entries(fields).forEach(([key, input]) => {
    if (!input) return;
    input.value = state.profile[key] || "";
    input.addEventListener("input", () => {
      state.profile[key] = input.value;
      saveProfile();
    });
  });
  renderSavedSignatures();
}

function renderSavedSignatures() {
  let wrap = ui.savedSignatureList;
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "saved-signatures";
    wrap.id = "savedSignatureList";
    document.querySelector(".autofill-body")?.append(wrap);
    ui.savedSignatureList = wrap;
  }
  if (!wrap) return;
  wrap.innerHTML = "";

  const current = getCurrentSignatureForSaving();
  const saveCurrent = document.createElement("button");
  saveCurrent.type = "button";
  saveCurrent.className = "save-signature-action";
  saveCurrent.textContent = "שמור חתימה נוכחית";
  saveCurrent.disabled = !current;
  saveCurrent.title = current ? "שמור את החתימה שצוירה כעת" : "צייר חתימה ואז שמור אותה";
  saveCurrent.addEventListener("click", () => {
    const signature = getCurrentSignatureForSaving();
    if (signature) saveSignatureToProfile(signature);
  });
  wrap.append(saveCurrent);

  const saved = getSavedSignatures();
  if (!saved.length) {
    const empty = document.createElement("div");
    empty.className = "saved-signature-empty";
    empty.textContent = "אין חתימות שמורות";
    wrap.append(empty);
    return;
  }

  saved.forEach((signature) => {
    const row = document.createElement("div");
    row.className = "saved-signature-row";

    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = signature.name || "חתימה";
    insert.title = "הכנס חתימה למסמך";
    insert.addEventListener("click", () => insertSavedSignature(signature.id));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "×";
    del.title = "מחק חתימה שמורה";
    del.addEventListener("click", () => removeSavedSignature(signature.id));

    row.append(insert, del);
    wrap.append(row);
  });
}

function getSavedSignatures() {
  if (!Array.isArray(state.profile.signatures)) state.profile.signatures = [];
  return state.profile.signatures;
}

function getCurrentSignatureForSaving() {
  if (!state.signatureSessionId) return null;
  return state.meta.signatures.find((item) => (
    item.sessionId === state.signatureSessionId && hasSignatureContent(item)
  )) || null;
}

function hasSignatureContent(item) {
  return getSignatureStrokes(item).some((stroke) => stroke.length > 1);
}

function commitActiveSignature() {
  const active = getCurrentSignatureForSaving();
  if (!active) return;
  setTransientInsertTool("pan");
  saveMeta();
  renderVisibleAnnotations();
  renderSavedSignatures();
}

function saveSignatureToProfile(item) {
  const saved = serializeSavedSignature(item);
  if (!saved) return;
  const signatures = getSavedSignatures();
  saved.name = `חתימה ${signatures.length + 1}`;
  signatures.push(saved);
  saveProfile();
  renderSavedSignatures();
}

function serializeSavedSignature(item) {
  const strokes = getSignatureStrokes(item).filter((stroke) => stroke.length > 1);
  if (!strokes.length) return null;
  const bounds = getSignatureBounds({ strokes });
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  if (contentW <= 0 || contentH <= 0) return null;
  return {
    id: crypto.randomUUID(),
    name: "",
    createdAt: Date.now(),
    aspect: contentW / contentH,
    strokeWidthRatio: (Number(item.strokeWidth) || 0.0025) / contentW,
    strokes: strokes.map((stroke) => stroke.map(([x, y]) => [
      (x - bounds.minX) / contentW,
      (y - bounds.minY) / contentH
    ]))
  };
}

function insertSavedSignature(id) {
  if (!state.pdf) return;
  const saved = getSavedSignatures().find((item) => item.id === id);
  if (!saved?.strokes?.length) return;
  const placement = getDefaultSignaturePlacement();
  const record = state.renderedPages.get(placement.pageNo);
  if (!record) return;
  const targetWidthPx = clamp(record.viewport.width * 0.28, 140, 260);
  const targetHeightPx = clamp(targetWidthPx / clamp(Number(saved.aspect) || 3, 1, 6), 42, 120);
  const left = clamp(placement.x - targetWidthPx / 2, 8, Math.max(8, record.viewport.width - targetWidthPx - 8));
  const top = clamp(placement.y - targetHeightPx / 2, 8, Math.max(8, record.viewport.height - targetHeightPx - 8));
  const targetWidth = targetWidthPx / record.viewport.width;
  const targetHeight = targetHeightPx / record.viewport.height;
  const signature = {
    id: crypto.randomUUID(),
    sessionId: null,
    page: placement.pageNo,
    strokes: saved.strokes.map((stroke) => stroke.map(([x, y]) => [
      (left / record.viewport.width) + x * targetWidth,
      (top / record.viewport.height) + y * targetHeight
    ])),
    strokeWidth: Math.max(0.0015, (Number(saved.strokeWidthRatio) || 0.012) * targetWidth)
  };
  state.meta.signatures.push(signature);
  saveMeta();
  renderAnnotationsForPage(placement.pageNo);
}

function removeSavedSignature(id) {
  state.profile.signatures = getSavedSignatures().filter((item) => item.id !== id);
  saveProfile();
  renderSavedSignatures();
}

function removeEmptySignatureDraft(sessionId) {
  if (!sessionId) return;
  const next = state.meta.signatures.filter((item) => (
    item.sessionId !== sessionId || hasSignatureContent(item)
  ));
  if (next.length !== state.meta.signatures.length) {
    state.meta.signatures = next;
    saveMeta();
  }
}

function applyQuickFill(type) {
  if (!state.pdf) return;
  const value = getQuickFillValue(type);
  if (!value) return;
  const selected = getActiveTextField();
  if (selected) {
    setFieldText(selected, value);
    return;
  }
  const placement = getDefaultFieldPlacement();
  addTextFieldWithValue(placement.pageNo, placement.x, placement.y, value);
}

function getActiveTextField() {
  const activeField = document.activeElement?.closest?.(".field-box");
  const id = activeField?.dataset.fieldId || state.selectedFieldId;
  return state.meta.fields.find((field) => field.id === id);
}

function getQuickFillValue(type) {
  if (type === "date") return new Intl.DateTimeFormat("he-IL").format(new Date());
  if (type === "check") return "✓";
  if (type === "cross") return "✕";
  return (state.profile[type] || "").trim();
}

function setFieldText(field, text) {
  field.text = text;
  const record = state.renderedPages.get(field.page);
  if (!record) {
    saveMeta();
    return;
  }
  const box = record.objectLayer.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
  const content = box?.querySelector(".field-content");
  if (!box || !content) {
    saveMeta();
    return;
  }
  content.textContent = text;
  state.selectedFieldId = field.id;
  markSelectedField(field.page);
  autosizeTextField(box, content, field, record);
  content.focus();
}

function getDefaultFieldPlacement() {
  const visiblePages = [...document.querySelectorAll(".page-shell")];
  const readerRect = ui.reader.getBoundingClientRect();
  const page = visiblePages.find((shell) => {
    const rect = shell.getBoundingClientRect();
    return rect.bottom > readerRect.top + 80 && rect.top < readerRect.bottom - 80;
  }) || visiblePages[0];
  if (!page) return { pageNo: state.currentPage, x: 24, y: 24 };
  const rect = page.getBoundingClientRect();
  return {
    pageNo: Number(page.dataset.page),
    x: clamp(readerRect.left + ui.reader.clientWidth * 0.5 - rect.left, 16, Math.max(16, rect.width - 80)),
    y: clamp(readerRect.top + ui.reader.clientHeight * 0.32 - rect.top, 16, Math.max(16, rect.height - 40))
  };
}

function getDefaultSignaturePlacement() {
  const placement = getDefaultFieldPlacement();
  return {
    pageNo: placement.pageNo,
    x: placement.x,
    y: placement.y + 22
  };
}

function updateToolLayers() {
  document.querySelectorAll(".annotation-layer").forEach((layer) => {
    layer.classList.toggle("active", state.tool === "highlight" || state.tool === "text" || state.tool === "signature");
  });
  document.querySelectorAll(".screenshot-layer").forEach((layer) => {
    layer.classList.toggle("active", state.screenshotSelection.active);
  });
  ui.reader.classList.toggle("can-pan", state.tool === "pan");
  ui.reader.classList.toggle("screenshot-selecting", state.screenshotSelection.active);
}

function renderVisibleAnnotations() {
  state.renderedPages.forEach((_, pageNo) => renderAnnotationsForPage(pageNo));
}

function wireFieldDrag(handle, field, item, record) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const start = {
      x: event.clientX,
      y: event.clientY,
      itemX: item.x,
      itemY: item.y
    };

    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - start.x) / record.viewport.width;
      const dy = (moveEvent.clientY - start.y) / record.viewport.height;
      item.x = clamp(start.itemX + dx, 0, Math.max(0, 1 - item.w));
      item.y = clamp(start.itemY + dy, 0, Math.max(0, 1 - item.h));
      setNormRect(field, item, record.viewport.width, record.viewport.height);
    };

    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      saveMeta();
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

function createAnnotationControls({ label, compact = false, onCommit, onSave, onDelete }) {
  const controls = document.createElement("div");
  controls.className = "annotation-controls";
  controls.setAttribute("aria-label", label);

  const move = document.createElement("span");
  move.className = "annotation-drag-hint";
  move.textContent = "↕";
  move.title = "גרור להזזה";

  const commit = document.createElement("button");
  commit.type = "button";
  commit.className = "annotation-commit";
  commit.textContent = "✓";
  commit.title = "סיים חתימה";
  commit.setAttribute("aria-label", `סיים ${label}`);
  commit.hidden = !onCommit;
  commit.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  commit.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onCommit?.();
  });

  const save = document.createElement("button");
  save.type = "button";
  save.className = "annotation-save";
  save.textContent = "S";
  save.title = "שמור למילוי מהיר";
  save.setAttribute("aria-label", `שמור ${label} למילוי מהיר`);
  save.hidden = !onSave;
  save.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  save.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSave?.();
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "annotation-delete";
  del.textContent = "×";
  del.title = "מחק";
  del.setAttribute("aria-label", `מחק ${label}`);
  del.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  del.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onDelete();
  });

  if (compact) {
    controls.append(move, del);
  } else {
    controls.append(move, commit, save, del);
  }
  return controls;
}

function wireRectAnnotationDrag(element, item, record) {
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    const start = {
      x: event.clientX,
      y: event.clientY,
      itemX: item.x,
      itemY: item.y
    };

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const dx = (moveEvent.clientX - start.x) / record.viewport.width;
      const dy = (moveEvent.clientY - start.y) / record.viewport.height;
      item.x = clamp(start.itemX + dx, 0, Math.max(0, 1 - item.w));
      item.y = clamp(start.itemY + dy, 0, Math.max(0, 1 - item.h));
      setNormRect(element, item, record.viewport.width, record.viewport.height);
    };

    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      saveMeta();
    };

    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  });
}

function wireSignatureDrag(element, item, record, paths) {
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    const bounds = getSignatureBounds(item);
    const start = {
      x: event.clientX,
      y: event.clientY,
      strokes: getSignatureStrokes(item).map((stroke) => stroke.map(([x, y]) => [x, y])),
      minDx: -bounds.minX,
      maxDx: 1 - bounds.maxX,
      minDy: -bounds.minY,
      maxDy: 1 - bounds.maxY
    };

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const dx = clamp((moveEvent.clientX - start.x) / record.viewport.width, start.minDx, start.maxDx);
      const dy = clamp((moveEvent.clientY - start.y) / record.viewport.height, start.minDy, start.maxDy);
      item.strokes = start.strokes.map((stroke) => stroke.map(([x, y]) => [x + dx, y + dy]));
      delete item.points;
      paths.forEach((path, index) => {
        const stroke = item.strokes[index] || [];
        path.setAttribute("d", pointsToSmoothPath(stroke.map(([x, y]) => [x * record.viewport.width, y * record.viewport.height])));
      });
      setSignatureMoveBox(element, item, record.viewport.width, record.viewport.height);
    };

    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      saveMeta();
    };

    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  });
}

function setSignatureMoveBox(element, item, width, height, isActiveSignature = false) {
  const bounds = getSignatureBounds(item);
  if (isActiveSignature && !getSignatureStrokes(item).flat().length && item.draftBox) {
    setNormRect(element, item.draftBox, width, height);
    return;
  }
  const padPxX = isActiveSignature ? 38 : 10;
  const padPxY = isActiveSignature ? 28 : 10;
  const minWidthPx = isActiveSignature ? 340 : 18;
  const minHeightPx = isActiveSignature ? 130 : 18;
  const padX = padPxX / width;
  const padY = padPxY / height;
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const targetW = Math.max(contentW + padX * 2, minWidthPx / width);
  const targetH = Math.max(contentH + padY * 2, minHeightPx / height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const box = {
    x: clamp(centerX - targetW / 2, 0, 1),
    y: clamp(centerY - targetH / 2, 0, 1),
    w: clamp(targetW, 0.025, 1),
    h: clamp(targetH, 0.025, 1)
  };
  if (box.x + box.w > 1) box.w = 1 - box.x;
  if (box.y + box.h > 1) box.h = 1 - box.y;
  setNormRect(element, box, width, height);
}

function getSignatureBounds(item) {
  const points = getSignatureStrokes(item).flat();
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

function autosizeTextField(field, content, item, record, persist = true) {
  const text = content.textContent || "";
  const measure = getTextMeasureElement();
  const style = getComputedStyle(content);
  measure.style.font = style.font;
  measure.style.lineHeight = style.lineHeight;
  measure.style.whiteSpace = "pre";
  measure.textContent = text || "הקלד כאן";

  const paddingX = 18;
  const paddingY = 10;
  const minWidth = 32;
  const minHeight = 24;
  const maxWidth = Math.max(80, record.viewport.width - item.x * record.viewport.width - 8);
  const measuredWidth = Math.ceil(measure.getBoundingClientRect().width + paddingX);
  const measuredHeight = Math.ceil(measure.getBoundingClientRect().height + paddingY);
  const widthPx = clamp(measuredWidth, minWidth, maxWidth);
  const heightPx = Math.max(minHeight, measuredHeight);

  item.w = widthPx / record.viewport.width;
  item.h = heightPx / record.viewport.height;
  setNormRect(field, item, record.viewport.width, record.viewport.height);
  if (persist) saveMeta();
}

function changeFieldFontSize(item, field, content, record, delta) {
  item.fontSize = clamp(getFieldFontSize(item) + delta, 8, 32);
  content.style.fontSize = `${item.fontSize}px`;
  autosizeTextField(field, content, item, record);
  content.focus();
}

function getFieldFontSize(item) {
  return Number.isFinite(Number(item.fontSize)) ? Number(item.fontSize) : 15;
}

function getSignatureStrokeWidth(item, pageWidth) {
  const normalized = Number(item.strokeWidth);
  if (Number.isFinite(normalized) && normalized > 0) {
    return clamp(normalized * pageWidth, 1.1, 2.4);
  }
  return 1.8;
}

function getActiveSignature(pageNo) {
  if (!state.signatureSessionId) state.signatureSessionId = crypto.randomUUID();
  let signature = state.meta.signatures.find((item) => (
    item.page === pageNo && item.sessionId === state.signatureSessionId
  ));
  if (!signature) {
    signature = {
      id: crypto.randomUUID(),
      sessionId: state.signatureSessionId,
      page: pageNo,
      strokes: [],
      strokeWidth: 0.0025
    };
    state.meta.signatures.push(signature);
  }
  return signature;
}

function getSignatureStrokes(item) {
  if (Array.isArray(item.strokes)) return item.strokes;
  if (Array.isArray(item.points)) {
    item.strokes = [item.points];
    delete item.points;
    return item.strokes;
  }
  item.strokes = [];
  return item.strokes;
}

function pointsToSmoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  if (points.length === 2) return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;

  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [x, y] = points[i];
    const [nextX, nextY] = points[i + 1];
    const midX = (x + nextX) / 2;
    const midY = (y + nextY) / 2;
    path += ` Q ${x} ${y} ${midX} ${midY}`;
  }
  const [lastX, lastY] = points[points.length - 1];
  return `${path} L ${lastX} ${lastY}`;
}

function getTextMeasureElement() {
  let measure = document.getElementById("textMeasure");
  if (!measure) {
    measure = document.createElement("span");
    measure.id = "textMeasure";
    measure.className = "text-measure";
    document.body.append(measure);
  }
  return measure;
}

function setNormRect(element, item, width, height) {
  element.style.left = `${item.x * width}px`;
  element.style.top = `${item.y * height}px`;
  element.style.width = `${item.w * width}px`;
  element.style.height = `${item.h * height}px`;
}

function positionBox(element, x1, y1, x2, y2) {
  element.style.left = `${Math.min(x1, x2)}px`;
  element.style.top = `${Math.min(y1, y2)}px`;
  element.style.width = `${Math.abs(x2 - x1)}px`;
  element.style.height = `${Math.abs(y2 - y1)}px`;
}

function normalizedBox(x1, y1, x2, y2, width, height) {
  return {
    x: Math.min(x1, x2) / width,
    y: Math.min(y1, y2) / height,
    w: Math.abs(x2 - x1) / width,
    h: Math.abs(y2 - y1) / height
  };
}

async function search() {
  if (!state.pdf) return;
  const term = ui.searchInput.value.trim();
  state.search = { term, hits: [], index: -1 };
  if (!term) {
    paintSearchHits();
    updateSearchLabel();
    return;
  }
  const options = { caseSensitive: ui.searchCase.checked, wholeWord: ui.searchWhole.checked };
  for (let pageNo = 1; pageNo <= state.pageCount; pageNo += 1) {
    const page = await state.pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: state.scale });
    for (const item of content.items) {
      const matches = findTextMatches(item.str, term, options);
      if (!matches.length) continue;
      const rect = textItemRect(item, viewport);
      for (const match of matches) {
        const matchRect = textMatchRect(item, rect, match, content.styles?.[item.fontName]);
        state.search.hits.push({
          page: pageNo,
          x: matchRect.x / viewport.width,
          y: matchRect.y / viewport.height,
          w: Math.max(8, matchRect.width) / viewport.width,
          h: Math.max(8, matchRect.height) / viewport.height
        });
      }
    }
  }
  state.search.index = state.search.hits.length ? 0 : -1;
  updateSearchLabel();
  if (state.search.index >= 0) await goToSearchHit(state.search.index);
  paintSearchHits();
}

function paintSearchHits() {
  document.querySelectorAll(".search-layer").forEach((layer) => layer.innerHTML = "");
  state.search.hits.forEach((hit, index) => {
    const record = state.renderedPages.get(hit.page);
    if (!record) return;
    const marker = document.createElement("div");
    marker.className = `search-hit${index === state.search.index ? " current" : ""}`;
    marker.style.left = `${hit.x * record.viewport.width}px`;
    marker.style.top = `${hit.y * record.viewport.height}px`;
    marker.style.width = `${hit.w * record.viewport.width}px`;
    marker.style.height = `${hit.h * record.viewport.height}px`;
    marker.title = `תוצאת חיפוש בעמוד ${hit.page}`;
    record.searchLayer.append(marker);
  });
}

async function moveSearch(direction) {
  if (!state.search.hits.length) return;
  state.search.index = (state.search.index + direction + state.search.hits.length) % state.search.hits.length;
  updateSearchLabel();
  await goToSearchHit(state.search.index);
  paintSearchHits();
}

function updateSearchLabel() {
  const total = state.search.hits.length;
  ui.searchCount.textContent = total ? `${state.search.index + 1}/${total}` : "0/0";
}

async function goToSearchHit(index) {
  const hit = state.search.hits[index];
  if (!hit) return;
  await goToPage(hit.page, { save: false, scroll: false });
  requestAnimationFrame(() => {
    const record = state.renderedPages.get(hit.page);
    if (!record) return;
    const targetTop = record.shell.offsetTop + (hit.y * record.viewport.height) - (ui.reader.clientHeight * 0.35);
    ui.reader.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  });
}

function findTextMatches(text, term, { caseSensitive, wholeWord }) {
  if (!text || !term) return [];
  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const needle = caseSensitive ? term : term.toLocaleLowerCase();
  const matches = [];
  let fromIndex = 0;
  while (fromIndex <= haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) break;
    const end = index + needle.length;
    if (!wholeWord || (isWordBoundary(text[index - 1]) && isWordBoundary(text[end]))) {
      matches.push({
        start: index,
        end
      });
    }
    fromIndex = Math.max(end, index + 1);
  }
  return matches;
}

function isWordBoundary(char) {
  return !char || !/[\p{L}\p{N}_]/u.test(char);
}

function textItemRect(item, viewport) {
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const height = Math.max(8, Math.hypot(tx[2], tx[3]));
  const width = Math.max(8, (item.width || item.str.length * height * .52) * viewport.scale);
  return { x: tx[4], y: tx[5] - height, width, height };
}

function textMatchRect(item, rect, match, style = {}) {
  const text = item.str || "";
  const fontFamily = style.fontFamily || "sans-serif";
  const fullWidth = measureSearchText(text, rect.height, fontFamily);
  if (!fullWidth) {
    const fallbackWidth = rect.width * ((match.end - match.start) / Math.max(1, text.length));
    const fallbackX = isRtlTextItem(item)
      ? rect.x + rect.width - (rect.width * (match.start / Math.max(1, text.length))) - fallbackWidth
      : rect.x + (rect.width * (match.start / Math.max(1, text.length)));
    return { x: fallbackX, y: rect.y, width: fallbackWidth, height: rect.height };
  }

  const prefixWidth = measureSearchText(text.slice(0, match.start), rect.height, fontFamily) * (rect.width / fullWidth);
  const matchWidth = measureSearchText(text.slice(match.start, match.end), rect.height, fontFamily) * (rect.width / fullWidth);
  const x = isRtlTextItem(item)
    ? rect.x + rect.width - prefixWidth - matchWidth
    : rect.x + prefixWidth;

  return { x, y: rect.y, width: matchWidth, height: rect.height };
}

function measureSearchText(text, fontSize, fontFamily) {
  if (!text) return 0;
  const measure = getTextMeasureElement();
  measure.style.fontSize = `${fontSize}px`;
  measure.style.fontFamily = fontFamily;
  measure.style.whiteSpace = "pre";
  measure.textContent = text;
  return measure.getBoundingClientRect().width;
}

function isRtlTextItem(item) {
  return item.dir === "rtl" || /[\u0590-\u08FF]/u.test(item.str || "");
}

function addBookmark() {
  if (!state.pdf) return;
  state.meta.bookmarks.push({
    id: crypto.randomUUID(),
    name: nextBookmarkName(state.currentPage),
    page: state.currentPage
  });
  saveMeta();
  renderBookmarks();
}

function renderBookmarks() {
  ui.bookmarkList.innerHTML = "";
  state.meta.bookmarks.forEach((bookmark) => {
    const item = document.createElement("div");
    item.className = "bookmark-item";

    const label = document.createElement("button");
    label.className = "bookmark-open";
    label.type = "button";
    label.textContent = `${bookmark.name} · ${bookmark.page}`;
    label.title = "פתח סימניה";
    label.addEventListener("click", () => goToPage(bookmark.page));

    const edit = document.createElement("button");
    edit.className = "icon-action";
    edit.textContent = "✎";
    edit.title = "ערוך שם";
    edit.setAttribute("aria-label", "ערוך שם סימניה");
    edit.addEventListener("click", () => startBookmarkEdit(item, bookmark));

    const del = document.createElement("button");
    del.className = "icon-action danger";
    del.textContent = "×";
    del.title = "מחק סימניה";
    del.setAttribute("aria-label", "מחק סימניה");
    del.addEventListener("click", () => {
      state.meta.bookmarks = state.meta.bookmarks.filter((entry) => entry.id !== bookmark.id);
      saveMeta();
      renderBookmarks();
    });
    item.append(label, edit, del);
    ui.bookmarkList.append(item);
  });
}

function nextBookmarkName(page) {
  const base = `עמוד ${page}`;
  const existing = new Set(state.meta.bookmarks.map((bookmark) => bookmark.name));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

function startBookmarkEdit(item, bookmark) {
  item.innerHTML = "";
  const input = document.createElement("input");
  input.value = bookmark.name;
  input.select();

  const save = document.createElement("button");
  save.className = "icon-action success";
  save.textContent = "✓";
  save.title = "שמור";
  save.setAttribute("aria-label", "שמור שם סימניה");

  const cancel = document.createElement("button");
  cancel.className = "icon-action";
  cancel.textContent = "↶";
  cancel.title = "בטל";
  cancel.setAttribute("aria-label", "בטל עריכת סימניה");

  const finish = () => {
    const name = input.value.trim();
    if (name) bookmark.name = name;
    saveMeta();
    renderBookmarks();
  };

  save.addEventListener("click", finish);
  cancel.addEventListener("click", renderBookmarks);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish();
    if (event.key === "Escape") renderBookmarks();
  });

  item.append(input, save, cancel);
  input.focus();
}

function savePosition() {
  const position = getVisibleReadingPosition();
  state.currentPage = position.page;
  state.meta.readingPosition = position.page;
  state.meta.readingOffset = position.offset;
  state.meta.savedReadingPosition = position.page;
  state.meta.savedReadingOffset = position.offset;
  saveMeta();
  updateStatus();
  announce(`המיקום נשמר בעמוד ${position.page}.`);
}

function restorePosition() {
  const page = state.meta.savedReadingPosition || state.meta.readingPosition || 1;
  const offset = state.meta.savedReadingPosition ? state.meta.savedReadingOffset : state.meta.readingOffset;
  goToPage(page, { offset: offset || 0, save: false });
}

async function goToPage(pageNo, options = {}) {
  if (!state.pdf) return;
  const { offset = 0, save = true, scroll = true } = options;
  state.currentPage = clamp(Math.round(pageNo), 1, state.pageCount);
  if (save) {
    state.meta.readingPosition = state.currentPage;
    state.meta.readingOffset = clamp(offset, 0, 1);
    saveMeta(false);
  }
  let target = document.querySelector(`[data-page="${state.currentPage}"]`);
  if (!target) {
    await render();
    target = document.querySelector(`[data-page="${state.currentPage}"]`);
  }
  cancelActivePageRender(state.currentPage);
  queueNearbyContent(state.currentPage, state.renderId);
  if (target && scroll) {
    const scrollLockId = lockScrollTracking();
    scrollToPageOffset(target, offset);
    releaseScrollTrackingAfterLayout(scrollLockId);
  }
  updateStatus();
}

function onScroll() {
  if (state.isRendering || state.isAdjustingScroll) return;
  const position = getVisibleReadingPosition();
  if (!position.page) return;
  if (position.page !== state.currentPage) {
    state.currentPage = position.page;
    cancelActivePageRender(position.page);
    queueNearbyContent(position.page, state.renderId);
    updateStatus();
  }
  state.meta.readingPosition = position.page;
  state.meta.readingOffset = position.offset;
  saveScrollMeta();
}

function onReaderWheel(event) {
  if (state.mode !== "single" || !state.pdf || event.ctrlKey || event.metaKey) return;
  if (isTypingTarget(event.target)) return;

  const primaryDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!primaryDelta) return;

  event.preventDefault();
  state.pageWheelDelta += primaryDelta;

  const now = performance.now();
  if (now < state.pageWheelLockedUntil) return;

  const threshold = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 18 : 0.8;
  if (Math.abs(state.pageWheelDelta) < threshold) return;

  const direction = state.pageWheelDelta > 0 ? 1 : -1;
  state.pageWheelDelta = 0;
  state.pageWheelLockedUntil = now + 180;
  goToPage(state.currentPage + direction, { offset: 0 });
}

function syncSinglePageWheel() {
  const shouldUsePageWheel = state.mode === "single";
  if (shouldUsePageWheel === state.isSinglePageWheelActive) return;
  state.pageWheelDelta = 0;
  state.pageWheelLockedUntil = 0;
  state.isSinglePageWheelActive = shouldUsePageWheel;
  if (shouldUsePageWheel) {
    ui.reader.addEventListener("wheel", onReaderWheel, { passive: false });
  } else {
    ui.reader.removeEventListener("wheel", onReaderWheel);
  }
}

function handleSinglePageKey(event) {
  if (state.mode !== "single" || !state.pdf || isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const nextKeys = new Set(["ArrowDown", "ArrowRight", "PageDown", " "]);
  const previousKeys = new Set(["ArrowUp", "ArrowLeft", "PageUp"]);
  if (!nextKeys.has(event.key) && !previousKeys.has(event.key)) return false;
  event.preventDefault();
  const direction = previousKeys.has(event.key) ? -1 : 1;
  goToPage(state.currentPage + direction, { offset: 0 });
  return true;
}

function getVisibleReadingPosition() {
  const shells = state.pageShells;
  if (!shells.length) return { page: state.currentPage || 1, offset: 0 };
  const readerTop = ui.reader.scrollTop;
  const viewportMiddle = readerTop + (ui.reader.clientHeight / 2);
  let low = 0;
  let high = shells.length - 1;
  let nearestIndex = 0;

  while (low <= high) {
    const middleIndex = Math.floor((low + high) / 2);
    const shell = shells[middleIndex];
    if (!shell) break;
    const shellMiddle = shell.offsetTop + (shell.offsetHeight / 2);
    nearestIndex = middleIndex;
    if (shellMiddle < viewportMiddle) low = middleIndex + 1;
    else high = middleIndex - 1;
  }

  let nearest = shells[nearestIndex] || shells[0];
  let nearestDistance = Math.abs((nearest.offsetTop + (nearest.offsetHeight / 2)) - viewportMiddle);
  for (let index = Math.max(0, nearestIndex - 2); index <= Math.min(shells.length - 1, nearestIndex + 2); index += 1) {
    const shell = shells[index];
    if (!shell) continue;
    const distance = Math.abs((shell.offsetTop + (shell.offsetHeight / 2)) - viewportMiddle);
    if (distance < nearestDistance) {
      nearest = shell;
      nearestDistance = distance;
    }
  }
  const offset = clamp((readerTop - nearest.offsetTop) / Math.max(1, nearest.offsetHeight), 0, 1);
  return { page: Number(nearest.dataset.page), offset };
}

function updateStatus() {
  ui.pageInput.value = state.currentPage || 1;
  ui.pageTotal.textContent = `/ ${state.pageCount || 0}`;
  ui.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  const savePositionButton = $("savePosition");
  const hasSavedPosition = Number(state.meta.savedReadingPosition) > 0;
  savePositionButton?.classList.toggle("has-saved-position", hasSavedPosition);
  savePositionButton?.setAttribute(
    "aria-label",
    hasSavedPosition
      ? `שמור מיקום. קיים מיקום שמור בעמוד ${state.meta.savedReadingPosition}`
      : "שמור מיקום"
  );
  const progress = state.pageCount ? (state.currentPage / state.pageCount) * 100 : 0;
  if (ui.pageSlider) {
    ui.pageSlider.min = "1";
    ui.pageSlider.max = String(Math.max(1, state.pageCount || 1));
    ui.pageSlider.value = String(clamp(state.currentPage || 1, 1, state.pageCount || 1));
    ui.pageSlider.disabled = !state.pdf || state.pageCount <= 1;
    ui.pageSlider.style.setProperty("--slider-progress", `${progress}%`);
  }
  const atStart = !state.pdf || state.currentPage <= 1;
  const atEnd = !state.pdf || state.currentPage >= state.pageCount;
  ["firstPage"].forEach((id) => {
    const button = $(id);
    if (button) button.disabled = atStart;
  });
  ["lastPage"].forEach((id) => {
    const button = $(id);
    if (button) button.disabled = atEnd;
  });
}

async function fitTo(kind) {
  state.fit = kind;
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: 1 });
  const isBookMode = state.mode.startsWith("book");
  
  if (isBookMode) {
    // Get the actual reader padding from CSS computed style
    const readerStyle = getComputedStyle(ui.reader);
    const paddingTop = parseFloat(readerStyle.paddingTop);
    const paddingRight = parseFloat(readerStyle.paddingRight);
    const readerPadding = paddingTop * 2 + paddingRight * 2;
    
    // Get the spread gap from CSS computed style
    const tempSpread = document.createElement("div");
    tempSpread.className = "spread";
    document.body.appendChild(tempSpread);
    const spreadStyle = getComputedStyle(tempSpread);
    const spreadGap = parseFloat(spreadStyle.gap) || 14;
    document.body.removeChild(tempSpread);
    
    const availableWidth = Math.max(320, ui.reader.clientWidth - readerPadding);
    const availableHeight = Math.max(320, ui.reader.clientHeight - readerPadding);
    
    // For book mode, fit two pages side-by-side
    // Equation: availableWidth >= scale * (2 * viewport.width) + spreadGap
    // Solving for scale: scale = (availableWidth - spreadGap) / (2 * viewport.width)
    
    let scaleW = (availableWidth - spreadGap) / (2 * viewport.width);
    
    // Verify the scale doesn't cause overflow
    const pageWidth = viewport.width * scaleW;
    const totalNeededWidth = pageWidth * 2 + spreadGap;
    if (totalNeededWidth > availableWidth) {
      scaleW = (availableWidth - spreadGap) / (2 * viewport.width) * 0.98; // 98% to ensure no overflow
    }
    
    const scaleH = availableHeight / viewport.height;
    state.scale = clamp(kind === "page" ? Math.min(scaleW, scaleH) : scaleW, 0.35, 3.5);
  } else {
    const readerStyle = getComputedStyle(ui.reader);
    const paddingTop = parseFloat(readerStyle.paddingTop);
    const paddingRight = parseFloat(readerStyle.paddingRight);
    const readerPadding = paddingTop * 2 + paddingRight * 2;
    
    const availableWidth = Math.max(320, ui.reader.clientWidth - readerPadding);
    const availableHeight = Math.max(320, ui.reader.clientHeight - readerPadding);
    const scaleW = availableWidth / viewport.width;
    const scaleH = availableHeight / viewport.height;
    state.scale = clamp(kind === "page" ? Math.min(scaleW, scaleH) : scaleW, 0.35, 3.5);
  }
  
  await render();
}

async function setScale(scale) {
  state.scale = clamp(scale, 0.35, 3.5);
  state.fit = "custom";
  await render();
}

function normalizeBookStart() {
  state.currentPage = clamp(state.currentPage, 1, state.pageCount || 1);
}

function getBookSpreads() {
  const spreads = [];
  if (state.pageCount >= 1) spreads.push([1]);
  for (let pageNo = 2; pageNo <= state.pageCount; pageNo += 2) {
    const pages = pageNo + 1 <= state.pageCount ? [pageNo, pageNo + 1] : [pageNo];
    spreads.push(state.mode === "book-rtl" ? [...pages].reverse() : pages);
  }
  return spreads;
}

function lockScrollTracking() {
  state.isAdjustingScroll = true;
  return ++state.scrollLockId;
}

function releaseScrollTrackingAfterLayout(scrollLockId) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (scrollLockId !== state.scrollLockId) return;
      state.isRendering = false;
      state.isAdjustingScroll = false;
    });
  });
}

function scrollCurrentIntoView(scrollLockId = lockScrollTracking()) {
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-page="${state.currentPage}"]`);
    if (target) scrollToPageOffset(target, state.meta.readingOffset || 0);
    releaseScrollTrackingAfterLayout(scrollLockId);
  });
}

function scrollToPageOffset(target, offset = 0) {
  const top = target.offsetTop + (target.offsetHeight * clamp(offset, 0, 1));
  const centeredLeft = target.offsetLeft - ((ui.reader.clientWidth - target.offsetWidth) / 2);
  const left = clamp(Math.round(centeredLeft), 0, Math.max(0, ui.reader.scrollWidth - ui.reader.clientWidth));
  const previousBehavior = ui.reader.style.scrollBehavior;
  ui.reader.style.scrollBehavior = "auto";
  ui.reader.scrollTo({ left, top: Math.max(0, top), behavior: "auto" });
  ui.reader.style.scrollBehavior = previousBehavior;
}

function toggleScreenshotMenu(event) {
  event.stopPropagation();
  const isOpen = !ui.screenshotMenu.hidden;
  ui.screenshotMenu.hidden = isOpen;
  ui.screenshotBtn.setAttribute("aria-expanded", String(!isOpen));
}

function closeScreenshotMenu() {
  if (!ui.screenshotMenu) return;
  ui.screenshotMenu.hidden = true;
  ui.screenshotBtn?.setAttribute("aria-expanded", "false");
}

function togglePrintMenu(event) {
  event.stopPropagation();
  const isOpen = !ui.printMenu.hidden;
  ui.printMenu.hidden = isOpen;
  ui.printBtn.setAttribute("aria-expanded", String(!isOpen));
}

function closePrintMenu() {
  if (!ui.printMenu) return;
  ui.printMenu.hidden = true;
  ui.printBtn?.setAttribute("aria-expanded", "false");
}

function openPrintDialog(mode = "document", source = null) {
  if (!state.pdf) {
    announce("יש לפתוח קובץ PDF לפני ההדפסה.");
    return;
  }
  hideSelectionActionMenu();
  $("printCurrentPage").textContent = String(state.currentPage);
  $("printRange").placeholder = `למשל 1-${Math.min(4, state.pageCount)}, ${state.pageCount}`;
  const hasSelection = Boolean(state.screenshotSelection.rect && state.screenshotSelection.pageNo);
  $("printSelectionScope").classList.toggle("unavailable", !hasSelection);
  $("printSelectionScope").querySelector("input").disabled = !hasSelection;
  $("stickerSelectionOption").classList.toggle("unavailable", !hasSelection);
  $("stickerSelectionOption").querySelector("input").disabled = !hasSelection;
  setPrintMode(mode);
  if (source === "selection" && hasSelection) {
    document.querySelector('[name="printScope"][value="selection"]').checked = true;
    document.querySelector('[name="stickerSource"][value="selection"]').checked = true;
  } else if (source) {
    const sourceName = state.printMode === "stickers" ? "stickerSource" : "printScope";
    const sourceInput = document.querySelector(`[name="${sourceName}"][value="${source}"]`);
    if (sourceInput && !sourceInput.disabled) sourceInput.checked = true;
  }
  updatePrintSummary();
  if (!ui.printDialog.open) ui.printDialog.showModal();
}

function closePrintDialog() {
  if (ui.printDialog.open) ui.printDialog.close();
}

function setPrintMode(mode) {
  state.printMode = mode === "stickers" ? "stickers" : "document";
  document.querySelectorAll("[data-print-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.printMode === state.printMode);
  });
  document.querySelectorAll("[data-print-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.printPanel !== state.printMode;
  });
  updatePrintSummary();
}

function getPrintOptions() {
  const mode = state.printMode;
  return {
    mode,
    scope: document.querySelector('[name="printScope"]:checked')?.value || "current",
    range: $("printRange").value.trim(),
    perSheet: Number($("pagesPerSheet").value),
    stickerSource: document.querySelector('[name="stickerSource"]:checked')?.value || "page",
    copies: Number($("stickerCopies").value),
    orientation: $("printOrientation").value,
    includeAnnotations: $("printAnnotations").checked,
    cutGuides: $("printCutGuides").checked
  };
}

function updatePrintSummary() {
  if (!state.pdf || !$("printSummary")) return;
  const options = getPrintOptions();
  if (options.mode === "stickers") {
    $("printSummary").textContent = `${options.copies} עותקים · גיליון אחד`;
    return;
  }
  let pageCount = options.scope === "all" ? state.pageCount : 1;
  if (options.scope === "range" && options.range) {
    try { pageCount = parsePageRange(options.range).length; } catch { pageCount = 0; }
  }
  const sheets = Math.max(1, Math.ceil(pageCount / options.perSheet));
  $("printSummary").textContent = `${pageCount || "—"} עמודים · ${sheets} ${sheets === 1 ? "גיליון" : "גיליונות"}`;
}

function parsePageRange(value) {
  if (!value.trim()) throw new Error("יש להזין טווח עמודים.");
  const pages = [];
  for (const part of value.split(",")) {
    const token = part.trim();
    const match = token.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!match) throw new Error("טווח העמודים אינו תקין.");
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > state.pageCount) {
      throw new Error(`מספרי העמודים חייבים להיות בין 1 ל-${state.pageCount}.`);
    }
    for (let page = start; page <= end; page += 1) {
      if (!pages.includes(page)) pages.push(page);
    }
  }
  return pages;
}

async function submitPrintOptions(event) {
  event.preventDefault();
  await runPrint(getPrintOptions());
}

async function runPrint(options) {
  if (!state.pdf) return;
  const printButton = $("startPrint");
  try {
    ui.printDialog.classList.add("is-busy");
    if (printButton) printButton.textContent = "מכין להדפסה…";
    announce("מכין את הדפים להדפסה…");

    let images;
    let itemsPerSheet;
    if (options.mode === "stickers") {
      const sourceCanvas = await getStickerSourceCanvas(options.stickerSource, options.includeAnnotations);
      const source = sourceCanvas.toDataURL("image/png");
      images = Array.from({ length: options.copies }, () => source);
      itemsPerSheet = options.copies;
    } else {
      if (options.scope === "selection") {
        images = [(await renderSelectionCanvas(options.includeAnnotations)).toDataURL("image/png")];
      } else {
        const pages = options.scope === "all"
          ? Array.from({ length: state.pageCount }, (_, index) => index + 1)
          : options.scope === "range" ? parsePageRange(options.range) : [state.currentPage];
        images = [];
        for (let index = 0; index < pages.length; index += 1) {
          announce(`מכין עמוד ${index + 1} מתוך ${pages.length}…`);
          images.push((await renderPrintablePage(pages[index], options.includeAnnotations)).toDataURL("image/jpeg", .94));
        }
      }
      itemsPerSheet = options.perSheet;
    }

    await printImageSheets(images, itemsPerSheet, options);
    closePrintDialog();
  } catch (error) {
    console.warn("Could not prepare print job:", error);
    announce(error.message || "לא ניתן להכין את ההדפסה.");
  } finally {
    ui.printDialog.classList.remove("is-busy");
    if (printButton) printButton.textContent = "הדפס עכשיו";
  }
}

async function ensurePrintablePage(pageNo) {
  const record = state.renderedPages.get(pageNo);
  if (!record) throw new Error(`עמוד ${pageNo} אינו זמין.`);
  if (!record.contentRendered && !record.contentRendering) queuePageContent(pageNo, state.renderId, true);
  await waitForPageContent(record);
  if (!record.contentRendered) {
    await renderPageContent(pageNo, state.renderId);
    await waitForPageContent(record);
  }
  return record;
}

async function renderPrintablePage(pageNo, includeAnnotations = false) {
  const record = await ensurePrintablePage(pageNo);
  return window.html2canvas(record.shell, {
    backgroundColor: "#ffffff",
    scale: 1.45,
    logging: false,
    ignoreElements: (element) => Boolean(
      element.closest?.(".screenshot-layer")
      || element.closest?.(".annotation-controls")
      || element.closest?.(".field-menu-button")
      || element.closest?.(".field-menu")
      || (!includeAnnotations && (element.closest?.(".annotation-layer") || element.closest?.(".object-layer")))
    )
  });
}

async function getStickerSourceCanvas(source, includeAnnotations = false) {
  if (source === "selection") return renderSelectionCanvas(includeAnnotations);
  if (source === "window") return renderVisibleWindowCanvas(includeAnnotations);
  return renderPrintablePage(state.currentPage, includeAnnotations);
}

async function renderVisibleWindowCanvas(includeAnnotations = false) {
  const readerRect = ui.reader.getBoundingClientRect();
  const scale = 1.25;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(readerRect.width * scale));
  canvas.height = Math.max(1, Math.round(readerRect.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  let drewContent = false;

  for (let pageNo = 1; pageNo <= state.pageCount; pageNo += 1) {
    const shell = state.renderedPages.get(pageNo)?.shell;
    if (!shell) continue;
    const rect = shell.getBoundingClientRect();
    const left = Math.max(rect.left, readerRect.left);
    const top = Math.max(rect.top, readerRect.top);
    const right = Math.min(rect.right, readerRect.right);
    const bottom = Math.min(rect.bottom, readerRect.bottom);
    if (right <= left || bottom <= top) continue;
    const pageCanvas = await renderPrintablePage(pageNo, includeAnnotations);
    const sx = (left - rect.left) * pageCanvas.width / rect.width;
    const sy = (top - rect.top) * pageCanvas.height / rect.height;
    const sw = (right - left) * pageCanvas.width / rect.width;
    const sh = (bottom - top) * pageCanvas.height / rect.height;
    context.drawImage(pageCanvas, sx, sy, sw, sh, (left - readerRect.left) * scale, (top - readerRect.top) * scale, (right - left) * scale, (bottom - top) * scale);
    drewContent = true;
  }
  if (!drewContent) throw new Error("אין תוכן נראה להדפסה בחלון.");
  return canvas;
}

function printImageSheets(images, perSheet, options) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.title = "תצוגת הדפסה";
    Object.assign(iframe.style, { position: "fixed", width: "1px", height: "1px", left: "-10000px", top: "0", border: "0" });
    document.body.append(iframe);
    const pageShape = options.orientation === "landscape" ? 1.414 : .707;
    const columns = Math.max(1, Math.ceil(Math.sqrt(perSheet * pageShape)));
    const rows = Math.ceil(perSheet / columns);
    const sheets = [];
    for (let index = 0; index < images.length; index += perSheet) {
      const sheetImages = images.slice(index, index + perSheet)
        .map((source) => `<div class="cell"><img src="${source}" alt=""></div>`).join("");
      sheets.push(`<section class="sheet" style="--cols:${columns};--rows:${rows}">${sheetImages}</section>`);
    }
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>הדפסה - ${escapeHtml(baseName())}</title><style>
      @page { size: A4 ${options.orientation}; margin: 7mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .sheet { width: 100%; height: calc(100vh - 1px); display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-template-rows: repeat(var(--rows), minmax(0, 1fr)); gap: 3mm; break-after: page; page-break-after: always; }
      .sheet:last-child { break-after: auto; page-break-after: auto; }
      .cell { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; overflow: hidden; ${options.cutGuides ? "border: .25mm dashed #999; padding: 2mm;" : ""} }
      img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
    </style></head><body>${sheets.join("")}</body></html>`);
    doc.close();

    const cleanup = () => { setTimeout(() => iframe.remove(), 1000); resolve(); };
    iframe.contentWindow.addEventListener("afterprint", cleanup, { once: true });
    Promise.all(Array.from(doc.images).map((image) => image.complete ? Promise.resolve() : new Promise((done, fail) => {
      image.onload = done;
      image.onerror = fail;
    }))).then(() => {
      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(cleanup, 60000);
      }, 100);
    }).catch((error) => { iframe.remove(); reject(error); });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function startScreenshotSelection() {
  if (!state.pdf) {
    announce("פתח קובץ PDF לפני סימון קטע להדפסה.");
    return;
  }
  state.screenshotSelection.active = true;
  state.screenshotSelection.dragging = false;
  clearScreenshotSelectionBox();
  hideSelectionActionMenu();
  updateToolLayers();
  announce("גרור מסגרת סביב הקטע שברצונך להדפיס.");
}

function stopScreenshotSelection() {
  if (!state.screenshotSelection.active && !state.screenshotSelection.box) return;
  state.screenshotSelection.active = false;
  state.screenshotSelection.dragging = false;
  state.screenshotSelection.pointerId = null;
  clearScreenshotSelectionBox();
  hideSelectionActionMenu();
  updateToolLayers();
}

function wireScreenshotLayer(layer, pageNo) {
  layer.addEventListener("pointerdown", (event) => {
    if (!state.screenshotSelection.active || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    layer.setPointerCapture(event.pointerId);
    clearScreenshotSelectionBox();
    hideSelectionActionMenu();

    const layerRect = layer.getBoundingClientRect();
    const startX = clamp(event.clientX - layerRect.left, 0, layerRect.width);
    const startY = clamp(event.clientY - layerRect.top, 0, layerRect.height);
    const box = document.createElement("div");
    box.className = "screenshot-selection-box";
    layer.append(box);

    Object.assign(state.screenshotSelection, {
      dragging: true,
      pointerId: event.pointerId,
      pageNo,
      box,
      rect: { x: startX, y: startY, w: 0, h: 0 },
      startX,
      startY
    });
    drawScreenshotSelection(event, layer);
  });

  layer.addEventListener("pointermove", (event) => {
    if (!state.screenshotSelection.dragging || state.screenshotSelection.pointerId !== event.pointerId) return;
    event.preventDefault();
    drawScreenshotSelection(event, layer);
  });

  const finish = (event) => {
    if (!state.screenshotSelection.dragging || state.screenshotSelection.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    drawScreenshotSelection(event, layer);
    state.screenshotSelection.dragging = false;
    state.screenshotSelection.pointerId = null;
    const rect = state.screenshotSelection.rect;
    if (!rect || rect.w < 6 || rect.h < 6) {
      clearScreenshotSelectionBox();
      hideSelectionActionMenu();
      return;
    }
    showSelectionActionMenu(layer, rect);
  };

  layer.addEventListener("pointerup", finish);
  layer.addEventListener("pointercancel", finish);
}

function drawScreenshotSelection(event, layer) {
  const selection = state.screenshotSelection;
  const layerRect = layer.getBoundingClientRect();
  const endX = clamp(event.clientX - layerRect.left, 0, layerRect.width);
  const endY = clamp(event.clientY - layerRect.top, 0, layerRect.height);
  const x = Math.min(selection.startX, endX);
  const y = Math.min(selection.startY, endY);
  const w = Math.abs(endX - selection.startX);
  const h = Math.abs(endY - selection.startY);
  selection.rect = { x, y, w, h };
  if (selection.box) {
    selection.box.style.left = `${x}px`;
    selection.box.style.top = `${y}px`;
    selection.box.style.width = `${w}px`;
    selection.box.style.height = `${h}px`;
  }
}

function clearScreenshotSelectionBox() {
  state.screenshotSelection.box?.remove();
  state.screenshotSelection.box = null;
  state.screenshotSelection.rect = null;
  state.screenshotSelection.pageNo = null;
}

function showSelectionActionMenu(layer, rect) {
  const layerRect = layer.getBoundingClientRect();
  const menu = ui.selectionActionMenu;
  menu.hidden = false;
  const menuWidth = menu.offsetWidth || 190;
  const menuHeight = menu.offsetHeight || 88;
  const left = clamp(layerRect.left + rect.x + rect.w + 8, 8, window.innerWidth - menuWidth - 8);
  const top = clamp(layerRect.top + rect.y, 8, window.innerHeight - menuHeight - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideSelectionActionMenu() {
  if (!ui.selectionActionMenu) return;
  ui.selectionActionMenu.hidden = true;
}

function showInsertActionMenu(event) {
  if (!state.pdf || !ui.insertActionMenu) return;
  const placement = getPagePlacementFromPoint(event.clientX, event.clientY, event.target);
  if (!placement) return;
  event.preventDefault();
  hideSelectionActionMenu();
  closeFieldMenus();
  state.insertMenuPlacement = placement;
  const menu = ui.insertActionMenu;
  menu.hidden = false;
  const menuWidth = menu.offsetWidth || 176;
  const menuHeight = menu.offsetHeight || 168;
  const left = clamp(event.clientX, 8, window.innerWidth - menuWidth - 8);
  const top = clamp(event.clientY, 8, window.innerHeight - menuHeight - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideInsertActionMenu() {
  if (!ui.insertActionMenu) return;
  ui.insertActionMenu.hidden = true;
}

function getPagePlacementFromPoint(clientX, clientY, target) {
  const shell = target?.closest?.(".page-shell") || [...document.querySelectorAll(".page-shell")].find((pageShell) => {
    const rect = pageShell.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  });
  if (!shell) return null;
  const pageNo = Number(shell.dataset.page);
  const record = state.renderedPages.get(pageNo);
  if (!record) return null;
  const rect = shell.getBoundingClientRect();
  return {
    pageNo,
    x: clamp(clientX - rect.left, 0, record.viewport.width),
    y: clamp(clientY - rect.top, 0, record.viewport.height)
  };
}

function runInsertAction(action) {
  const placement = state.insertMenuPlacement;
  hideInsertActionMenu();
  if (!placement || !state.renderedPages.has(placement.pageNo)) return;
  if (action === "text") {
    setTransientInsertTool("pan");
    addTextField(placement.pageNo, placement.x, placement.y);
  } else if (action === "note") {
    setTransientInsertTool("pan");
    addTextFieldWithValue(placement.pageNo, placement.x, placement.y, "", {
      type: "note",
      w: 0.22,
      h: 0.085,
      fontSize: 14
    });
  } else if (action === "highlight") {
    startHighlightToolAtPlacement(placement);
  } else if (action === "signature") {
    startSignatureAtPlacement(placement);
  }
  state.insertMenuPlacement = null;
}

function startHighlightToolAtPlacement({ pageNo }) {
  const record = state.renderedPages.get(pageNo);
  if (!record) return;
  state.tool = "highlight";
  state.signatureSessionId = null;
  document.querySelectorAll("[data-tool]").forEach((btn) => btn.classList.remove("active"));
  updateToolLayers();
  announce("כלי הדגשה פעיל. גרור מלבן על האזור שברצונך להדגיש.");
}

function startSignatureAtPlacement({ pageNo, x, y }) {
  const record = state.renderedPages.get(pageNo);
  if (!record) return;
  state.tool = "signature";
  state.signatureSessionId = crypto.randomUUID();
  document.querySelectorAll("[data-tool]").forEach((btn) => btn.classList.remove("active"));
  const widthPx = clamp(record.viewport.width * 0.42, 260, 380);
  const heightPx = clamp(record.viewport.height * 0.16, 110, 150);
  const left = clamp(x - widthPx / 2, 0, Math.max(0, record.viewport.width - widthPx));
  const top = clamp(y - heightPx / 2, 0, Math.max(0, record.viewport.height - heightPx));
  state.meta.signatures.push({
    id: crypto.randomUUID(),
    sessionId: state.signatureSessionId,
    page: pageNo,
    strokes: [],
    strokeWidth: 0.0025,
    draftBox: {
      x: left / record.viewport.width,
      y: top / record.viewport.height,
      w: widthPx / record.viewport.width,
      h: heightPx / record.viewport.height
    }
  });
  saveMeta();
  updateToolLayers();
  renderAnnotationsForPage(pageNo);
  announce("מצב חתימה פעיל. צייר את החתימה בתוך המסמך ולחץ ✓ לסיום.");
}

function setTransientInsertTool(tool) {
  const previousSignatureSessionId = state.signatureSessionId;
  if (state.tool === "signature" && tool !== "signature") {
    removeEmptySignatureDraft(previousSignatureSessionId);
  }
  state.tool = tool;
  state.signatureSessionId = null;
  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  });
  updateToolLayers();
  renderVisibleAnnotations();
}

async function saveSelectionScreenshot() {
  try {
    const pageNo = state.screenshotSelection.pageNo;
    const canvas = await renderSelectionCanvas();
    downloadBlob(await canvasToBlob(canvas), `${baseName()}-selection-page-${pageNo}.png`);
  } catch (error) {
    console.warn("Could not save selected screenshot:", error);
    announce("לא ניתן לשמור את האזור שנבחר.");
  }
}

async function copySelectionScreenshot() {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) {
      announce("הדפדפן לא מאפשר העתקת תמונה ללוח.");
      return;
    }
    const canvas = await renderSelectionCanvas();
    const blob = await canvasToBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    announce("הצילום הועתק ללוח.");
  } catch (error) {
    console.warn("Could not copy selected screenshot:", error);
    announce("לא ניתן להעתיק את הצילום ללוח בדפדפן הזה.");
  }
}

async function renderSelectionCanvas(includeAnnotations = true) {
  const selection = state.screenshotSelection;
  if (!state.pdf || !window.html2canvas || !selection.rect || !selection.pageNo) {
    throw new Error("No selected screenshot area");
  }
  const record = state.renderedPages.get(selection.pageNo);
  if (!record) throw new Error("Selected page is not rendered");
  if (record.contentRendering) await waitForPageContent(record);
  if (!record.contentRendered) await renderPageContent(selection.pageNo, state.renderId);
  if (record.contentRendering) await waitForPageContent(record);

  const pageCanvas = await window.html2canvas(record.shell, {
    backgroundColor: "#ffffff",
    scale: 1,
    ignoreElements: (element) => Boolean(
      element.closest?.(".screenshot-layer")
      || element.closest?.(".selection-action-menu")
      || element.closest?.(".insert-action-menu")
      || (!includeAnnotations && (element.closest?.(".annotation-layer") || element.closest?.(".object-layer")))
    )
  });

  const shellRect = record.shell.getBoundingClientRect();
  const scaleX = pageCanvas.width / Math.max(1, shellRect.width);
  const scaleY = pageCanvas.height / Math.max(1, shellRect.height);
  const sourceX = Math.round(selection.rect.x * scaleX);
  const sourceY = Math.round(selection.rect.y * scaleY);
  const sourceW = Math.max(1, Math.round(selection.rect.w * scaleX));
  const sourceH = Math.max(1, Math.round(selection.rect.h * scaleY));
  const cropped = document.createElement("canvas");
  cropped.width = sourceW;
  cropped.height = sourceH;
  cropped.getContext("2d").drawImage(pageCanvas, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
  return cropped;
}

function waitForPageContent(record) {
  return new Promise((resolve) => {
    const check = () => {
      if (!record.contentRendering) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

async function takeScreenshot() {
  if (!state.pdf || !window.html2canvas) return;
  const target = document.querySelector(`[data-page="${state.currentPage}"]`) || ui.pages;
  const canvas = await window.html2canvas(target, { backgroundColor: "#ffffff", scale: 1 });
  downloadBlob(await canvasToBlob(canvas), `${baseName()}-page-${state.currentPage}.png`);
}

async function exportPdf() {
  if (!state.pdf || !window.PDFLib) return;
  const { PDFDocument, rgb } = window.PDFLib;
  const pdfDoc = await PDFDocument.load(state.fileBytes.slice(0));
  const pages = pdfDoc.getPages();

  state.meta.highlights.forEach((item) => {
    const page = pages[item.page - 1];
    const { width, height } = page.getSize();
    page.drawRectangle({
      x: item.x * width,
      y: height - (item.y + item.h) * height,
      width: item.w * width,
      height: item.h * height,
      color: rgb(1, .86, .04),
      opacity: .34
    });
  });

  for (const item of state.meta.fields) {
    const page = pages[item.page - 1];
    const { width, height } = page.getSize();
    if (item.type === "note") {
      page.drawRectangle({
        x: item.x * width,
        y: height - (item.y + item.h) * height,
        width: item.w * width,
        height: item.h * height,
        color: rgb(1, .98, .92),
        borderColor: rgb(.92, .7, .03),
        borderWidth: .8,
        opacity: .96
      });
    }
    const imageBytes = await textToPng(
      item.text || "",
      Math.max(80, item.w * width * 2),
      Math.max(36, item.h * height * 2),
      getFieldFontSize(item) * 2
    );
    const image = await pdfDoc.embedPng(imageBytes);
    page.drawImage(image, {
      x: item.x * width,
      y: height - (item.y + item.h) * height,
      width: item.w * width,
      height: item.h * height
    });
  }

  state.meta.signatures.forEach((item) => {
    const page = pages[item.page - 1];
    const { width, height } = page.getSize();
    getSignatureStrokes(item).forEach((stroke) => {
      for (let i = 1; i < stroke.length; i += 1) {
        const [x1, y1] = stroke[i - 1];
        const [x2, y2] = stroke[i];
        page.drawLine({
          start: { x: x1 * width, y: height - y1 * height },
          end: { x: x2 * width, y: height - y2 * height },
          thickness: clamp((Number(item.strokeWidth) || 0.0025) * width, 0.9, 1.8),
          color: rgb(.06, .09, .16)
        });
      }
    });
  });

  const bytes = await pdfDoc.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${baseName()}-signed.pdf`);
}

function loadMeta() {
  try {
    return normalizeMeta({ ...emptyMeta(), ...JSON.parse(localStorage.getItem(storageKey()) || "{}") });
  } catch {
    return emptyMeta();
  }
}

function normalizeMeta(meta) {
  return {
    ...emptyMeta(),
    ...meta,
    bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : [],
    highlights: Array.isArray(meta.highlights) ? meta.highlights : [],
    fields: Array.isArray(meta.fields) ? meta.fields : [],
    signatures: Array.isArray(meta.signatures) ? meta.signatures : [],
    readingPosition: Number.isFinite(Number(meta.readingPosition)) ? Number(meta.readingPosition) : 1,
    readingOffset: Number.isFinite(Number(meta.readingOffset)) ? clamp(Number(meta.readingOffset), 0, 1) : 0,
    savedReadingPosition: Number.isFinite(Number(meta.savedReadingPosition)) ? Number(meta.savedReadingPosition) : null,
    savedReadingOffset: Number.isFinite(Number(meta.savedReadingOffset)) ? clamp(Number(meta.savedReadingOffset), 0, 1) : 0
  };
}

function saveMeta(renderTime = true) {
  if (!state.fingerprint) return;
  state.meta.updatedAt = renderTime ? Date.now() : state.meta.updatedAt;
  localStorage.setItem(storageKey(), JSON.stringify(state.meta));
}

function storageKey() {
  return `daily-pdf-reader:${state.fingerprint}`;
}

function loadProfile() {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(profileKey()) || "{}"));
  } catch {
    return normalizeProfile({});
  }
}

function normalizeProfile(profile) {
  return {
    name: "",
    address: "",
    email: "",
    phone: "",
    ...profile,
    signatures: Array.isArray(profile.signatures) ? profile.signatures : []
  };
}

function saveProfile() {
  localStorage.setItem(profileKey(), JSON.stringify(state.profile));
}

function profileKey() {
  return "daily-pdf-reader:profile";
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function announce(message) {
  if (!ui.statusMessage) return;
  ui.statusMessage.textContent = message;
  ui.statusMessage.classList.add("visible");
  setTimeout(() => {
    ui.statusMessage.classList.remove("visible");
  }, 4200);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create image from canvas"));
      }
    }, "image/png", .95);
  });
}

function startReaderPan(event) {
  if (!state.pdf || isTypingTarget(event.target)) return;
  const spaceDrag = state.spacePressed && event.button === 0;
  const panToolDrag = state.tool === "pan" && event.button === 0;
  if (!spaceDrag && !panToolDrag) return;
  event.preventDefault();
  ui.reader.setPointerCapture(event.pointerId);
  state.panning = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: ui.reader.scrollLeft,
    top: ui.reader.scrollTop
  };
  ui.reader.classList.add("panning");
}

function moveReaderPan(event) {
  if (!state.panning || state.panning.pointerId !== event.pointerId) return;
  event.preventDefault();
  ui.reader.scrollLeft = state.panning.left - (event.clientX - state.panning.x);
  ui.reader.scrollTop = state.panning.top - (event.clientY - state.panning.y);
}

function stopReaderPan(event) {
  if (!state.panning || state.panning.pointerId !== event.pointerId) return;
  state.panning = null;
  ui.reader.classList.remove("panning");
}

async function textToPng(text, width, height, fontSize = 30) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.font = `${Math.max(10, fontSize)}px Segoe UI, Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";
  wrapCanvasText(ctx, text, canvas.width - 14, canvas.height / 2, canvas.width - 18, Math.max(14, fontSize * 1.25));
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/png" })
    : await canvasToBlob(canvas);
  return new Uint8Array(await blob.arrayBuffer());
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((entry, index) => ctx.fillText(entry, x, startY + index * lineHeight));
}

function baseName() {
  return (state.file?.name || "document").replace(/\.pdf$/i, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, [contenteditable='true'], button"));
}
