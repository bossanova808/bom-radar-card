import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { rollup } from 'rollup';

import { BOM_LAYERS } from '../src/bom-layers.js';

const LEAFLET_TEST_MODULE_ID = '\0bom-radar-card-leaflet-test-double';

async function buildLifecycleBundle() {
  const bundle = await rollup({
    input: fileURLToPath(new URL('../src/bom-radar-card.js', import.meta.url)),
    plugins: [{
      name: 'leaflet-lifecycle-test-boundary',
      resolveId(source) {
        return source === 'leaflet/dist/leaflet-src.esm.js' ? LEAFLET_TEST_MODULE_ID : null;
      },
      load(id) {
        if (id !== LEAFLET_TEST_MODULE_ID) return null;
        return `
          const leaflet = globalThis.__leafletTestDouble;
          export const TileLayer = leaflet.TileLayer;
          export const DomUtil = leaflet.DomUtil;
          export const DomEvent = leaflet.DomEvent;
          export const map = (...args) => leaflet.map(...args);
          export const tileLayer = (...args) => leaflet.tileLayer(...args);
          export const marker = (...args) => leaflet.marker(...args);
          export const divIcon = (...args) => leaflet.divIcon(...args);
          export const layerGroup = (...args) => leaflet.layerGroup(...args);
          export const canvas = (...args) => leaflet.canvas(...args);
          export const circleMarker = (...args) => leaflet.circleMarker(...args);
          export const control = (...args) => leaflet.control(...args);
          control.zoom = (...args) => leaflet.control.zoom(...args);
        `;
      },
    }],
  });

  try {
    const { output } = await bundle.generate({ format: 'iife' });
    return output[0].code;
  } finally {
    await bundle.close();
  }
}

// Rollup resolves the card's real ESM dependency graph. Only Leaflet, the
// browser rendering boundary, is replaced so lifecycle behavior still runs
// through the card's public custom-element API without network or a fake copy
// of the card implementation.
const lifecycleBundle = await buildLifecycleBundle();

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }

  _read() {
    this.classes = new Set(String(this.element.className || '').split(/\s+/).filter(Boolean));
  }

  _write() {
    this.element.className = [...this.classes].join(' ');
  }

  add(...classNames) {
    this._read();
    classNames.forEach((className) => this.classes.add(className));
    this._write();
  }

  remove(...classNames) {
    this._read();
    classNames.forEach((className) => this.classes.delete(className));
    this._write();
  }

  contains(className) {
    this._read();
    return this.classes.has(className);
  }

  toggle(className, force) {
    this._read();
    const shouldAdd = force ?? !this.classes.has(className);
    if (shouldAdd) this.classes.add(className);
    else this.classes.delete(className);
    this._write();
    return shouldAdd;
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  return element.localName === selector.toLowerCase();
}

class FakeElement {
  constructor(localName = 'div', ownerDocument = null) {
    this.localName = localName.toLowerCase();
    this.tagName = localName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = {
      removeProperty(name) {
        delete this[name];
      },
    };
    this.dataset = {};
    this.attributes = {};
    this.eventListeners = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.id = '';
    this.alt = '';
    this.type = '';
    this.title = '';
    this.value = '';
    this.checked = false;
    this.src = '';
    this.textContent = '';
    this.clientWidth = 640;
    this.clientHeight = 400;
    this.isConnected = true;
    this._innerHTML = '';
  }

  get childNodes() {
    return this.children;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    return this.insertBefore(child, null);
  }

  insertBefore(child, referenceNode) {
    if (child.localName === '#document-fragment') {
      for (const fragmentChild of [...child.children]) {
        this.insertBefore(fragmentChild, referenceNode);
      }
      child.children = [];
      return child;
    }

    child.remove();
    child.parentNode = this;
    if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
    const referenceIndex = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (referenceIndex === -1) this.children.push(child);
    else this.children.splice(referenceIndex, 0, child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes[name] = stringValue;
    if (name === 'id') this.id = stringValue;
    if (name === 'class') this.className = stringValue;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, listener) {
    this.eventListeners[type] ||= [];
    this.eventListeners[type].push(listener);
  }

  dispatchEvent(event) {
    const resolvedEvent = typeof event === 'string' ? { type: event } : event;
    for (const listener of this.eventListeners[resolvedEvent.type] || []) {
      listener.call(this, resolvedEvent);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  getBoundingClientRect() {
    return {
      top: 0,
      bottom: this.clientHeight,
      left: 0,
      right: this.clientWidth,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }

  insertAdjacentHTML(position, html) {
    const element = this.ownerDocument.createElement('div');
    const classMatch = String(html).match(/class="([^"]+)"/);
    if (classMatch) element.className = classMatch[1];
    element.innerHTML = html;

    if (position === 'beforebegin' && this.parentNode) {
      this.parentNode.insertBefore(element, this);
    } else {
      this.appendChild(element);
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      if (matchesSelector(element, selector)) matches.push(element);
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
}

class FakeDocumentFragment extends FakeElement {
  constructor(ownerDocument) {
    super('#document-fragment', ownerDocument);
  }
}

function buildCardFragment(document, html) {
  const fragment = new FakeDocumentFragment(document);
  if (!html.includes('<ha-card')) return fragment;

  const style = document.createElement('style');
  const card = document.createElement('ha-card');
  const content = document.createElement('div');
  content.className = html.includes('card-content is-square') ? 'card-content is-square' : 'card-content';

  const map = document.createElement('div');
  map.id = 'map';
  const heightMatch = html.match(/id="map" style="height: ([0-9]+)px"/);
  map.style.height = `${heightMatch?.[1] ?? 300}px`;

  const loading = document.createElement('div');
  loading.id = 'loading';
  loading.className = 'loading-overlay';
  loading.innerHTML = '<div class="spinner"></div><div class="loading-text">Loading BOM weather data</div>';

  content.appendChild(map);
  content.appendChild(loading);

  if (html.includes('id="play-btn"')) {
    const controls = document.createElement('div');
    controls.className = 'controls';
    const play = document.createElement('button');
    play.id = 'play-btn';
    play.innerHTML = html.match(/id="play-btn"[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? '';
    const timeline = document.createElement('div');
    timeline.id = 'timeline';
    timeline.className = 'timeline';
    const label = document.createElement('span');
    label.id = 'time-label';
    label.textContent = '--:--';
    controls.appendChild(play);
    controls.appendChild(timeline);
    controls.appendChild(label);
    content.appendChild(controls);
  }

  card.appendChild(content);
  fragment.appendChild(style);
  fragment.appendChild(card);
  return fragment;
}

class FakeTemplate extends FakeElement {
  constructor(ownerDocument) {
    super('template', ownerDocument);
    this.content = new FakeDocumentFragment(ownerDocument);
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.content = buildCardFragment(this.ownerDocument, this._innerHTML);
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

class FakeShadowRoot extends FakeElement {
  constructor(ownerDocument) {
    super('#shadow-root', ownerDocument);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

let currentDocument = null;

class FakeHTMLElement extends FakeElement {
  constructor() {
    super('custom-element', currentDocument);
    this.isConnected = false;
  }

  attachShadow() {
    this.shadowRoot = new FakeShadowRoot(this.ownerDocument);
    return this.shadowRoot;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document', null);
    this.ownerDocument = this;
    this.head = new FakeElement('head', this);
  }

  createElement(localName) {
    if (localName === 'template') return new FakeTemplate(this);
    return new FakeElement(localName, this);
  }
}

function createCustomElementsRegistry() {
  const constructors = new Map();
  const hiddenNextGets = new Set();
  const defineAttempts = [];

  return {
    defineAttempts,
    define(name, constructor) {
      defineAttempts.push(name);
      if (constructors.has(name)) throw new Error(`the name "${name}" has already been used`);
      constructors.set(name, constructor);
    },
    get(name) {
      if (hiddenNextGets.delete(name)) return undefined;
      return constructors.get(name);
    },
    hideNextGet(name) {
      hiddenNextGets.add(name);
    },
  };
}

function createScheduler() {
  let nextId = 1;
  const timeouts = new Map();
  const intervals = new Map();
  const animationFrames = new Map();

  return {
    timeouts,
    intervals,
    animationFrames,
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(callback, delay = 0) {
      const id = nextId++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = nextId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    flushAnimationFrames() {
      const queuedFrames = [...animationFrames.entries()];
      animationFrames.clear();
      queuedFrames.forEach(([, callback]) => callback(0));
    },
    runNextTimeout(delay) {
      const entry = [...timeouts.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected an active ${delay}ms timeout`);
      const [id, timer] = entry;
      timeouts.delete(id);
      timer.callback();
    },
    activeTimeoutDelays() {
      return [...timeouts.values()].map((timer) => timer.delay);
    },
  };
}

function createLeafletDouble(document) {
  const state = {
    maps: [],
    tileLayerCalls: [],
    tileLayerThrows: false,
  };

  class FakeMap {
    constructor(container, options) {
      this.container = container;
      this.options = options;
      this.layers = [];
      this.controls = [];
      this.events = {};
      this.panes = {};
      this.invalidateSizeCalls = 0;
      this.removed = false;
      this.attributionControl = {
        attributions: [],
        setPrefix: () => {},
        addAttribution: (attribution) => this.attributionControl.attributions.push(attribution),
      };
    }

    getZoom() {
      return this.options.zoom;
    }

    getPane(name) {
      return this.panes[name] || null;
    }

    createPane(name) {
      const pane = { style: {} };
      this.panes[name] = pane;
      return pane;
    }

    on(eventNames, listener) {
      eventNames.split(/\s+/).forEach((eventName) => {
        this.events[eventName] ||= [];
        this.events[eventName].push(listener);
      });
      return this;
    }

    hasLayer(layer) {
      return this.layers.includes(layer);
    }

    removeLayer(layer) {
      this.layers = this.layers.filter((candidate) => candidate !== layer);
      return this;
    }

    remove() {
      this.removed = true;
      this.layers = [];
    }

    invalidateSize() {
      this.invalidateSizeCalls += 1;
      return this;
    }

    panTo() {
      return this;
    }
  }

  class FakeTileLayer {
    constructor(url = '', options = {}) {
      this.url = url;
      this.options = options;
      this.opacity = options.opacity ?? 1;
    }

    addTo(map) {
      this._map = map;
      map.layers.push(this);
      return this;
    }

    setOpacity(opacity) {
      this.opacity = opacity;
      return this;
    }

    bringToFront() {
      return this;
    }
  }

  function control() {
    return {
      addTo(map) {
        this._container = this.onAdd?.(map) ?? null;
        map.controls.push(this);
        return this;
      },
    };
  }

  control.zoom = () => ({
    addTo(map) {
      map.controls.push(this);
      return this;
    },
  });

  const leaflet = {
    map(container, options) {
      const map = new FakeMap(container, options);
      state.maps.push(map);
      return map;
    },
    tileLayer(url, options) {
      state.tileLayerCalls.push({ url, options });
      if (state.tileLayerThrows) throw new Error('tile layer failed');
      return new FakeTileLayer(url, options);
    },
    TileLayer: {
      extend(prototype) {
        class ExtendedTileLayer extends FakeTileLayer {}
        Object.assign(ExtendedTileLayer.prototype, prototype);
        return ExtendedTileLayer;
      },
    },
    control,
    marker() {
      const marker = {
        addTo(map) {
          map.layers.push(marker);
          return marker;
        },
      };
      return marker;
    },
    divIcon(options) {
      return options;
    },
    layerGroup() {
      const layers = [];
      const group = {
        addTo(map) {
          group._map = map;
          map.layers.push(group);
          return group;
        },
        addLayer(layer) {
          layers.push(layer);
          return group;
        },
        removeLayer(layer) {
          const index = layers.indexOf(layer);
          if (index !== -1) layers.splice(index, 1);
          return group;
        },
      };
      return group;
    },
    canvas() {
      return { _ctx: {}, _redraw() {} };
    },
    circleMarker() {
      return { setStyle() {}, setRadius() {} };
    },
    DomUtil: {
      create(localName, className, parent) {
        const element = document.createElement(localName);
        element.className = className || '';
        parent?.appendChild(element);
        return element;
      },
    },
    DomEvent: {
      disableClickPropagation() {},
      disableScrollPropagation() {},
      on(element, eventName, listener) {
        element.addEventListener(eventName, listener);
      },
      stop() {},
    },
  };

  return { leaflet, state };
}

function createWindow() {
  const listeners = {};
  return {
    customCards: [],
    addEventListener(type, listener) {
      listeners[type] ||= new Set();
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type]?.delete(listener);
    },
    listenerCount(type) {
      return listeners[type]?.size ?? 0;
    },
    matchMedia() {
      return { matches: false };
    },
  };
}

function evaluateLifecycleBundle(sandbox) {
  new vm.Script(lifecycleBundle, { filename: 'bom-radar-card.lifecycle-bundle.js' }).runInContext(sandbox);
}

function createHarness({ tileLayerThrows = false, imageResponder = () => true } = {}) {
  const document = new FakeDocument();
  currentDocument = document;
  const customElements = createCustomElementsRegistry();
  const scheduler = createScheduler();
  const window = createWindow();
  const { leaflet, state: leafletState } = createLeafletDouble(document);
  leafletState.tileLayerThrows = tileLayerThrows;
  const consoleMessages = { info: [], warn: [], error: [] };
  const observerState = { resize: [], intersection: [] };
  const imageProbeState = { requests: [] };

  class FakeImage {
    constructor() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.onload = null;
      this.onerror = null;
      this._src = '';
    }

    set src(value) {
      this._src = String(value);
      const request = { image: this, url: this._src };
      imageProbeState.requests.push(request);
      const response = imageResponder(request.url, imageProbeState.requests.length - 1);
      Promise.resolve(response).then((available) => {
        if (available === undefined) return;
        if (available) {
          this.naturalWidth = 256;
          this.naturalHeight = 256;
          this.onload?.();
        } else {
          this.onerror?.();
        }
      });
    }

    get src() {
      return this._src;
    }
  }

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      this.observations = [];
      observerState.resize.push(this);
    }

    observe(target, options) {
      this.observations.push({ target, options });
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      this.observations = [];
      observerState.intersection.push(this);
    }

    observe(target) {
      this.observations.push(target);
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      Object.assign(this, options);
    }
  }

  const sandbox = vm.createContext({
    __leafletTestDouble: leaflet,
    window,
    document,
    Image: FakeImage,
    customElements,
    HTMLElement: FakeHTMLElement,
    ResizeObserver: FakeResizeObserver,
    IntersectionObserver: FakeIntersectionObserver,
    CustomEvent: FakeCustomEvent,
    console: {
      info: (...args) => consoleMessages.info.push(args),
      warn: (...args) => consoleMessages.warn.push(args),
      error: (...args) => consoleMessages.error.push(args),
    },
    setTimeout: (callback, delay) => scheduler.setTimeout(callback, delay),
    clearTimeout: (id) => scheduler.clearTimeout(id),
    setInterval: (callback, delay) => scheduler.setInterval(callback, delay),
    clearInterval: (id) => scheduler.clearInterval(id),
    requestAnimationFrame: (callback) => scheduler.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => scheduler.cancelAnimationFrame(id),
  });

  evaluateLifecycleBundle(sandbox);

  return {
    Card: customElements.get('bom-radar-card'),
    Editor: customElements.get('bom-radar-card-editor'),
    consoleMessages,
    customElements,
    document,
    imageProbeState,
    leafletState,
    observerState,
    sandbox,
    scheduler,
    window,
  };
}

function issueConfig(overrides = {}) {
  return {
    layer: 'reflectivity',
    zoom_level: 7,
    map_height: 400,
    basemap_provider: 'bom',
    basemap_style: 'dark',
    frame_delay: 500,
    restart_delay: 1500,
    frame_count: 9,
    show_marker: false,
    show_zoom: false,
    show_recenter: false,
    show_layer_switcher: false,
    show_legend: false,
    show_attribution: false,
    show_lightning: false,
    ...overrides,
  };
}

function issueHass(states = {}) {
  return {
    config: { latitude: -27.55, longitude: 153.08 },
    states,
  };
}

function setConnected(card, isConnected) {
  card.isConnected = isConnected;
  if (isConnected) card.connectedCallback();
  else card.disconnectedCallback();
}

async function flushUntil(predicate, message = 'condition was not met') {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await Promise.resolve();
    if (predicate()) return;
  }
  assert.ok(predicate(), message);
}

function timeline(card) {
  return card.shadowRoot.getElementById('timeline');
}

function activeFrameIndex(card) {
  return timeline(card).children.findIndex((frame) => frame.classList.contains('active'));
}

test('initializes after Home Assistant sets config and hass while the card is disconnected', async () => {
  const harness = createHarness();
  const card = new harness.Card();

  card.setConfig(issueConfig());
  card.hass = issueHass();
  assert.equal(harness.leafletState.maps.length, 0);

  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);

  assert.equal(harness.leafletState.maps.length, 1);
  assert.equal(timeline(card).children.length, 9);
  assert.equal(harness.imageProbeState.requests.length, 2);
  for (const { url } of harness.imageProbeState.requests) {
    const probeUrl = new URL(url);
    assert.equal(probeUrl.searchParams.get('TILEMATRIXSET'), 'GoogleMapsCompatible_BoM');
    assert.equal(probeUrl.searchParams.get('TILEMATRIX'), '0');
    assert.equal(probeUrl.searchParams.get('TILEROW'), '0');
    assert.equal(probeUrl.searchParams.get('TILECOL'), '0');
  }
  assert.equal(card.shadowRoot.getElementById('loading').classList.contains('hidden'), true);
  assert.ok(harness.leafletState.maps[0].invalidateSizeCalls >= 1);

  setConnected(card, false);
});

test('waits for both config and hass when the card is connected first', async () => {
  const harness = createHarness();
  const card = new harness.Card();

  setConnected(card, true);
  card.setConfig(issueConfig());
  assert.equal(harness.leafletState.maps.length, 0);

  card.hass = issueHass();
  await flushUntil(() => timeline(card)?.children.length === 9);

  assert.equal(harness.leafletState.maps.length, 1);
  assert.equal(timeline(card).children.length, 9);

  setConnected(card, false);
});

test('disconnects and reconnects through a full Home Assistant view lifecycle', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig());
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);

  const firstMap = harness.leafletState.maps[0];
  const firstResizeObserver = harness.observerState.resize[0];
  const firstIntersectionObserver = harness.observerState.intersection[0];
  const firstMapInvalidations = firstMap.invalidateSizeCalls;
  assert.equal(harness.window.listenerCount('resize'), 1);
  assert.equal(harness.scheduler.intervals.size, 1);
  assert.ok(harness.scheduler.activeTimeoutDelays().includes(500));
  assert.equal(firstResizeObserver.disconnected, false);
  assert.equal(firstIntersectionObserver.disconnected, false);

  setConnected(card, false);
  assert.equal(firstMap.removed, true);
  assert.equal(harness.window.listenerCount('resize'), 0);
  assert.equal(harness.scheduler.intervals.size, 0);
  assert.equal(harness.scheduler.activeTimeoutDelays().includes(500), false);
  assert.equal(firstResizeObserver.disconnected, true);
  assert.equal(firstIntersectionObserver.disconnected, true);

  harness.scheduler.flushAnimationFrames();
  assert.equal(firstMap.invalidateSizeCalls, firstMapInvalidations);

  setConnected(card, true);
  await flushUntil(() => harness.leafletState.maps.length === 2 && timeline(card)?.children.length === 9);

  const secondMap = harness.leafletState.maps[1];
  const secondResizeObserver = harness.observerState.resize[1];
  const secondIntersectionObserver = harness.observerState.intersection[1];
  assert.notEqual(secondMap, firstMap);
  assert.equal(timeline(card).children.length, 9);
  assert.equal(harness.window.listenerCount('resize'), 1);
  assert.equal(harness.scheduler.intervals.size, 1);
  assert.ok(harness.scheduler.activeTimeoutDelays().includes(500));
  assert.equal(secondResizeObserver.disconnected, false);
  assert.equal(secondIntersectionObserver.disconnected, false);

  const secondMapInvalidations = secondMap.invalidateSizeCalls;

  setConnected(card, false);
  assert.equal(secondMap.removed, true);
  assert.equal(harness.window.listenerCount('resize'), 0);
  assert.equal(harness.scheduler.intervals.size, 0);
  assert.equal(harness.scheduler.activeTimeoutDelays().includes(500), false);
  assert.equal(secondResizeObserver.disconnected, true);
  assert.equal(secondIntersectionObserver.disconnected, true);
  harness.scheduler.flushAnimationFrames();
  assert.equal(secondMap.invalidateSizeCalls, secondMapInvalidations);
});

test('does not finish an initialization after the card disconnects', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig());
  setConnected(card, true);

  card.hass = issueHass();
  const abandonedMap = harness.leafletState.maps[0];
  assert.ok(abandonedMap, 'map creation begins synchronously');

  setConnected(card, false);
  await flushUntil(() => abandonedMap.removed);
  for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();

  assert.equal(harness.leafletState.maps.length, 1);
  assert.equal(abandonedMap.layers.length, 0);
  assert.equal(timeline(card).children.length, 0);
  assert.equal(harness.window.listenerCount('resize'), 0);
  assert.equal(harness.scheduler.intervals.size, 0);
});

test('suppresses stale radar completion across an immediate disconnect and reconnect', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig());
  setConnected(card, true);

  card.hass = issueHass();
  const firstMap = harness.leafletState.maps[0];
  assert.ok(firstMap, 'the first map is created before radar timestamps resolve');

  setConnected(card, false);
  setConnected(card, true);
  const secondMap = harness.leafletState.maps[1];
  assert.ok(secondMap, 'reconnect starts a fresh initialization');

  await flushUntil(() => timeline(card)?.children.length === 9);

  assert.equal(firstMap.removed, true);
  assert.equal(firstMap.layers.length, 0);
  assert.equal(secondMap.removed, false);
  assert.equal(timeline(card).children.length, 9);
  assert.equal(secondMap.layers.length, 10, 'one basemap plus nine current radar frames');

  setConnected(card, false);
});

test('corrects a confirmed forecast rollover with z0 probes while preserving seven frames', async () => {
  const probeResults = [true, false, false, true];
  const harness = createHarness({
    imageResponder: (_url, index) => probeResults[index],
  });
  const card = new harness.Card();
  card.setConfig(issueConfig({ layer: 'forecast_rain_chance_daily', frame_count: 9 }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 7);

  assert.equal(harness.imageProbeState.requests.length, 4);
  const probeUrls = harness.imageProbeState.requests.map(({ url }) => new URL(url));
  for (const url of probeUrls) {
    assert.equal(url.searchParams.get('TILEMATRIXSET'), 'GoogleMapsCompatible_BoM_ADFD');
    assert.equal(url.searchParams.get('TILEMATRIX'), '0');
    assert.equal(url.searchParams.get('TILEROW'), '0');
    assert.equal(url.searchParams.get('TILECOL'), '0');
  }

  const nominalFirst = probeUrls[0].searchParams.get('time');
  const nominalLast = probeUrls[1].searchParams.get('time');
  const replacement = probeUrls[3].searchParams.get('time');
  assert.equal(probeUrls[2].searchParams.get('time'), nominalLast, 'the failed boundary is retried once');
  assert.equal(Date.parse(nominalFirst) - Date.parse(replacement), 24 * 60 * 60 * 1000);
  assert.equal(card._timestamps.length, 7);
  assert.equal(card._timestamps[0], replacement);
  assert.equal(card._timestamps[1], nominalFirst);
  assert.equal(card._timestamps.at(-1), new Date(Date.parse(nominalLast) - 24 * 60 * 60 * 1000)
    .toISOString().replace('.000Z', 'Z'));

  setConnected(card, false);
});

test('keeps old layers visible and commits only the newest overlapping same-layer refresh', async () => {
  let deferDailyProbes = false;
  const pendingProbeResolutions = [];
  const harness = createHarness({
    imageResponder: (url) => {
      if (!deferDailyProbes || !url.includes(BOM_LAYERS.forecast_rain_chance_daily.id)) return true;
      return new Promise((resolve) => pendingProbeResolutions.push(resolve));
    },
  });
  const card = new harness.Card();
  card.setConfig(issueConfig({ show_layer_label: true, show_layer_switcher: true }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);

  const originalLayers = [...card._radarLayers];
  const originalTimestamps = [...card._timestamps];
  deferDailyProbes = true;
  const firstRefresh = card._setLayer('forecast_rain_chance_daily');
  await flushUntil(() => pendingProbeResolutions.length === 2, 'daily boundary probes did not start');

  assert.equal(card._radarLayers.length, originalLayers.length);
  assert.ok(card._radarLayers.every((layer, index) => layer === originalLayers[index]),
    'the current frames remain mounted while probes run');
  assert.equal(JSON.stringify(card._timestamps), JSON.stringify(originalTimestamps));

  const secondRefresh = card._refreshData();
  await flushUntil(() => pendingProbeResolutions.length === 2, 'overlap should share in-flight probes');
  pendingProbeResolutions.forEach((resolve) => resolve(true));
  await firstRefresh;
  await secondRefresh;

  assert.equal(card._config.layer, 'forecast_rain_chance_daily');
  assert.equal(card._committedRadarLayerKey, 'forecast_rain_chance_daily');
  assert.equal(card._timestamps.length, 7);
  assert.equal(card._radarLayers.length, 7);
  assert.ok(originalLayers.every((layer) => !card._map.layers.includes(layer)));
  assert.equal(card._map.layers.length, 8, 'one basemap plus seven current forecast frames');
  assert.equal(card._layerSwitcher.button.title, 'Weather layer: Chance of Rain Daily');
  assert.match(card.shadowRoot.querySelector('.layer-badge').innerHTML, /Chance of Rain Daily/);
  assert.ok(timeline(card).children.every((dot) => /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/
    .test(dot.getAttribute('aria-label'))), 'the committed daily product owns timeline formatting');
  assert.equal(harness.scheduler.activeTimeoutDelays().filter((delay) => delay === 500).length, 1);

  setConnected(card, false);
});

test('discards an A-to-B completion after the card switches back to A', async () => {
  let deferDailyProbes = false;
  const pendingProbeResolutions = [];
  const harness = createHarness({
    imageResponder: (url) => {
      if (!deferDailyProbes || !url.includes(BOM_LAYERS.forecast_rain_chance_daily.id)) return true;
      return new Promise((resolve) => pendingProbeResolutions.push(resolve));
    },
  });
  const card = new harness.Card();
  card.setConfig(issueConfig());
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);
  const reflectivityTimestamps = [...card._timestamps];

  deferDailyProbes = true;
  const switchToDaily = card._setLayer('forecast_rain_chance_daily');
  await flushUntil(() => pendingProbeResolutions.length === 2, 'daily boundary probes did not start');
  const switchBack = card._setLayer('reflectivity');
  await switchBack;

  pendingProbeResolutions.forEach((resolve) => resolve(true));
  await switchToDaily;

  assert.equal(card._config.layer, 'reflectivity');
  assert.equal(JSON.stringify(card._timestamps), JSON.stringify(reflectivityTimestamps));
  assert.equal(card._radarLayers.length, 9);
  assert.equal(card._map.layers.length, 10, 'one basemap plus the current nine reflectivity frames');
  assert.equal(harness.scheduler.activeTimeoutDelays().filter((delay) => delay === 500).length, 1);

  setConnected(card, false);
});

test('offers and manages the opt-in radar coverage layer only for supported radar products', async () => {
  const harness = createHarness();
  const editor = new harness.Editor();
  editor.setConfig({ layer: 'reflectivity' });
  assert.match(editor.shadowRoot.innerHTML, /id="show_radar_coverage"/);
  editor.setConfig({ layer: 'air_temperature', show_radar_coverage: true });
  assert.doesNotMatch(editor.shadowRoot.innerHTML, /id="show_radar_coverage"/);

  const card = new harness.Card();
  card.setConfig(issueConfig({ show_radar_coverage: true, allow_overzoom: true }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9 && card._radarCoverageLayer);

  const firstCoverageLayer = card._radarCoverageLayer;
  const coverageCalls = () => harness.leafletState.tileLayerCalls
    .filter(({ url }) => url.includes('/radar_coverage/MapServer/tile/'));
  assert.equal(coverageCalls().length, 1);
  assert.equal(firstCoverageLayer.options.maxNativeZoom, 10);
  assert.equal(firstCoverageLayer.options.maxZoom, 10);
  assert.equal(card._map.panes.bomRadarCoveragePane.style.zIndex, '350');
  assert.equal(card._map.panes.bomRadarCoveragePane.style.pointerEvents, 'none');

  await card._setLayer('air_temperature');
  assert.equal(card._radarCoverageLayer, null);
  assert.equal(card._map.hasLayer(firstCoverageLayer), false);

  await card._setLayer('rain_rate');
  assert.ok(card._radarCoverageLayer);
  assert.notEqual(card._radarCoverageLayer, firstCoverageLayer);
  assert.equal(coverageCalls().length, 2);
  card._syncRadarCoverageLayer();
  assert.equal(coverageCalls().length, 2, 'repeated sync does not duplicate the coverage layer');

  const map = card._map;
  setConnected(card, false);
  assert.equal(card._radarCoverageLayer, null);
  assert.equal(map.layers.length, 0);
});

test('keeps radar and coverage consistent while a supported layer switch is pending', async () => {
  let deferDailyProbes = false;
  const pendingProbeResolutions = [];
  const harness = createHarness({
    imageResponder: (url) => {
      if (!deferDailyProbes || !url.includes(BOM_LAYERS.forecast_rain_chance_daily.id)) return true;
      return new Promise((resolve) => pendingProbeResolutions.push(resolve));
    },
  });
  const card = new harness.Card();
  card.setConfig(issueConfig({ show_radar_coverage: true }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => card._radarCoverageLayer && timeline(card)?.children.length === 9);

  const oldCoverage = card._radarCoverageLayer;
  const oldLayers = [...card._radarLayers];
  deferDailyProbes = true;
  const switchLayer = card._setLayer('forecast_rain_chance_daily');
  await flushUntil(() => pendingProbeResolutions.length === 2);

  assert.equal(card._radarCoverageLayer, oldCoverage);
  assert.ok(card._radarLayers.every((layer, index) => layer === oldLayers[index]));
  pendingProbeResolutions.forEach((resolve) => resolve(true));
  await switchLayer;

  assert.equal(card._radarCoverageLayer, null);
  assert.equal(card._radarLayers.length, 7);
  assert.ok(oldLayers.every((layer) => !card._map.hasLayer(layer)));

  setConnected(card, false);
});

test('leaves the previous radar layers mounted if a refresh replacement throws', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig());
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);

  const originalLayers = [...card._radarLayers];
  const originalTimestamps = [...card._timestamps];
  const originalMapLayers = [...card._map.layers];
  const originalTileLayerExtend = harness.sandbox.__leafletTestDouble.TileLayer.extend;
  let partiallyAddedLayer = null;
  harness.sandbox.__leafletTestDouble.TileLayer.extend = () => class {
    addTo(map) {
      partiallyAddedLayer = this;
      map.layers.push(this);
      throw new Error('tile layer add failed');
    }
  };
  try {
    await card._refreshData();
  } finally {
    harness.sandbox.__leafletTestDouble.TileLayer.extend = originalTileLayerExtend;
  }

  assert.equal(card._radarLayers.length, originalLayers.length);
  assert.ok(card._radarLayers.every((layer, index) => layer === originalLayers[index]));
  assert.equal(JSON.stringify(card._timestamps), JSON.stringify(originalTimestamps));
  assert.ok(originalLayers.every((layer) => card._map.hasLayer(layer)));
  assert.equal(card._map.layers.length, originalMapLayers.length);
  assert.equal(card._map.hasLayer(partiallyAddedLayer), false,
    'a layer registered by Leaflet before addTo throws is removed');
  assert.equal(harness.consoleMessages.warn.length, 1);
  assert.match(String(harness.consoleMessages.warn[0][0]), /Refresh failed/);

  setConnected(card, false);
});

test('rolls a failed product switch back without mislabelling the previous radar data', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig({
    show_layer_label: true,
    show_layer_switcher: true,
    show_radar_coverage: true,
  }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => card._radarCoverageLayer && timeline(card)?.children.length === 9);

  const originalLayers = [...card._radarLayers];
  const originalTimestamps = [...card._timestamps];
  const originalCoverageLayer = card._radarCoverageLayer;
  const originalMapLayers = [...card._map.layers];
  const originalTimeline = timeline(card).children.map((dot) => ({
    className: dot.className,
    label: dot.getAttribute('aria-label'),
  }));
  const originalTimeLabel = card.shadowRoot.getElementById('time-label').textContent;
  const originalTileLayerExtend = harness.sandbox.__leafletTestDouble.TileLayer.extend;
  let partiallyAddedLayer = null;
  harness.sandbox.__leafletTestDouble.TileLayer.extend = () => class {
    addTo(map) {
      partiallyAddedLayer = this;
      map.layers.push(this);
      throw new Error('target product add failed');
    }
  };
  try {
    await card._setLayer('forecast_rain_chance_daily');
  } finally {
    harness.sandbox.__leafletTestDouble.TileLayer.extend = originalTileLayerExtend;
  }

  const reflectivityOption = card._layerSwitcher.panel.querySelectorAll('.bom-layer-option')
    .find((option) => option.dataset.layer === 'reflectivity');
  const forecastOption = card._layerSwitcher.panel.querySelectorAll('.bom-layer-option')
    .find((option) => option.dataset.layer === 'forecast_rain_chance_daily');
  assert.equal(card._config.layer, 'reflectivity');
  assert.ok(card._radarLayers.every((layer, index) => layer === originalLayers[index]));
  assert.equal(JSON.stringify(card._timestamps), JSON.stringify(originalTimestamps));
  assert.equal(card._radarCoverageLayer, originalCoverageLayer);
  assert.deepEqual(card._map.layers, originalMapLayers);
  assert.equal(card._map.hasLayer(partiallyAddedLayer), false);
  assert.deepEqual(timeline(card).children.map((dot) => ({
    className: dot.className,
    label: dot.getAttribute('aria-label'),
  })), originalTimeline);
  assert.equal(card.shadowRoot.getElementById('time-label').textContent, originalTimeLabel);
  assert.equal(card._layerSwitcher.button.title, 'Weather layer: Rain Reflectivity');
  assert.equal(reflectivityOption.getAttribute('aria-pressed'), 'true');
  assert.equal(forecastOption.getAttribute('aria-pressed'), 'false');
  assert.match(card.shadowRoot.querySelector('.layer-badge').innerHTML, /Rain Reflectivity/);
  assert.equal(harness.consoleMessages.warn.length, 1);
  assert.match(String(harness.consoleMessages.warn[0][0]), /Failed to switch to layer/);

  setConnected(card, false);
});

test('rolls A-to-B-pending then C-failed back to the committed A product', async () => {
  let deferDailyProbes = false;
  const pendingDailyProbeResolutions = [];
  const harness = createHarness({
    imageResponder: (url) => {
      if (!deferDailyProbes || !url.includes(BOM_LAYERS.forecast_rain_chance_daily.id)) return true;
      return new Promise((resolve) => pendingDailyProbeResolutions.push(resolve));
    },
  });
  const card = new harness.Card();
  card.setConfig(issueConfig({
    show_layer_label: true,
    show_layer_switcher: true,
    show_radar_coverage: true,
  }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => card._radarCoverageLayer && timeline(card)?.children.length === 9);

  const committedTimestamps = [...card._timestamps];
  const committedCoverageLayer = card._radarCoverageLayer;
  const committedTimelineLabels = timeline(card).children.map((dot) => dot.getAttribute('aria-label'));
  deferDailyProbes = true;
  const switchToB = card._setLayer('forecast_rain_chance_daily');
  await flushUntil(() => pendingDailyProbeResolutions.length === 2, 'B boundary probes did not start');

  await card._rebuildRadarLayers();
  const rebuiltCommittedLayers = [...card._radarLayers];
  assert.equal(card._committedRadarLayerKey, 'reflectivity');
  assert.ok(rebuiltCommittedLayers.every((layer) => (
    layer.getTileUrl({ z: 0, x: 1, y: 0 }).includes(BOM_LAYERS.reflectivity.id)
  )),
    'a zoom rebuild uses the displayed A product while B is still pending');

  const originalTileLayerExtend = harness.sandbox.__leafletTestDouble.TileLayer.extend;
  let partiallyAddedCLayer = null;
  harness.sandbox.__leafletTestDouble.TileLayer.extend = () => class {
    addTo(map) {
      partiallyAddedCLayer = this;
      map.layers.push(this);
      throw new Error('C product add failed');
    }
  };
  try {
    await card._setLayer('air_temperature');
  } finally {
    harness.sandbox.__leafletTestDouble.TileLayer.extend = originalTileLayerExtend;
  }

  assert.equal(card._config.layer, 'reflectivity');
  assert.equal(card._committedRadarLayerKey, 'reflectivity');
  assert.ok(card._radarLayers.every((layer, index) => layer === rebuiltCommittedLayers[index]));
  assert.equal(JSON.stringify(card._timestamps), JSON.stringify(committedTimestamps));
  assert.equal(card._radarCoverageLayer, committedCoverageLayer);
  assert.equal(card._map.hasLayer(partiallyAddedCLayer), false);
  assert.equal(card._layerSwitcher.button.title, 'Weather layer: Rain Reflectivity');
  assert.match(card.shadowRoot.querySelector('.layer-badge').innerHTML, /Rain Reflectivity/);
  assert.deepEqual(
    timeline(card).children.map((dot) => dot.getAttribute('aria-label')),
    committedTimelineLabels,
    'the timeline remains formatted for committed observed radar data',
  );

  pendingDailyProbeResolutions.forEach((resolve) => resolve(true));
  await switchToB;

  assert.equal(card._config.layer, 'reflectivity');
  assert.equal(card._committedRadarLayerKey, 'reflectivity');
  assert.ok(card._radarLayers.every((layer, index) => layer === rebuiltCommittedLayers[index]),
    'the stale B completion cannot replace committed A');
  assert.equal(card._radarCoverageLayer, committedCoverageLayer);
  assert.equal(card._layerSwitcher.button.title, 'Weather layer: Rain Reflectivity');

  setConnected(card, false);
  assert.equal(card._committedRadarLayerKey, null);
});

test('cleans up a coverage layer if Leaflet registers it before addTo throws', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig());
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);

  const originalMapLayers = [...card._map.layers];
  const originalTileLayer = harness.sandbox.__leafletTestDouble.tileLayer;
  harness.sandbox.__leafletTestDouble.tileLayer = (url, options) => {
    if (url.includes('/radar_coverage/MapServer/tile/')) {
      throw new Error('coverage construction failed');
    }
    return originalTileLayer(url, options);
  };
  card._config.show_radar_coverage = true;
  assert.doesNotThrow(() => card._syncRadarCoverageLayer());
  assert.equal(card._radarCoverageLayer, null);
  assert.deepEqual(card._map.layers, originalMapLayers);
  assert.equal(harness.consoleMessages.warn.length, 1);

  let partiallyAddedCoverageLayer = null;
  harness.sandbox.__leafletTestDouble.tileLayer = (url, options) => {
    if (!url.includes('/radar_coverage/MapServer/tile/')) {
      return originalTileLayer(url, options);
    }
    partiallyAddedCoverageLayer = {
      options,
      addTo(map) {
        map.layers.push(this);
        throw new Error('coverage add failed');
      },
    };
    return partiallyAddedCoverageLayer;
  };
  try {
    assert.doesNotThrow(() => card._syncRadarCoverageLayer());
  } finally {
    harness.sandbox.__leafletTestDouble.tileLayer = originalTileLayer;
  }

  assert.equal(card._radarCoverageLayer, null);
  assert.equal(card._map.hasLayer(partiallyAddedCoverageLayer), false);
  assert.deepEqual(card._map.layers, originalMapLayers);
  assert.equal(harness.consoleMessages.warn.length, 2);
  assert.ok(harness.consoleMessages.warn.every(([message]) => /radar coverage layer/.test(String(message))));

  setConnected(card, false);
});

test('cleans up a partial map failure and recovers on a later hass update', async () => {
  const harness = createHarness({ tileLayerThrows: true });
  const card = new harness.Card();
  card.setConfig(issueConfig());
  setConnected(card, true);
  card.hass = issueHass();

  await flushUntil(
    () => card.shadowRoot.getElementById('loading')?.innerHTML.includes('Failed to load BOM weather data'),
    'initialization failure was not rendered',
  );

  const failedMap = harness.leafletState.maps[0];
  assert.equal(failedMap.removed, true);
  assert.equal(failedMap.layers.length, 0);
  assert.equal(harness.window.listenerCount('resize'), 0);
  assert.equal(harness.consoleMessages.error.length, 1);

  harness.leafletState.tileLayerThrows = false;
  card.hass = issueHass();
  await flushUntil(() => harness.leafletState.maps.length === 2 && timeline(card)?.children.length === 9);

  assert.equal(harness.leafletState.maps[1].removed, false);
  assert.equal(timeline(card).children.length, 9);
  assert.equal(card.shadowRoot.getElementById('loading').classList.contains('hidden'), true);

  setConnected(card, false);
});

test('setConfig restarts an initialized paused card in its documented playing state', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig());
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);

  const firstMap = harness.leafletState.maps[0];
  const playButton = card.shadowRoot.getElementById('play-btn');
  playButton.click();
  assert.match(playButton.innerHTML, /M8 5v14l11-7z/);

  card.setConfig(issueConfig({ map_height: 500 }));
  await flushUntil(() => harness.leafletState.maps.length === 2 && timeline(card)?.children.length === 9);

  const restartedPlayButton = card.shadowRoot.getElementById('play-btn');
  assert.equal(firstMap.removed, true);
  assert.match(restartedPlayButton.innerHTML, /<rect/);
  assert.equal(activeFrameIndex(card), 8);
  assert.equal(card.shadowRoot.getElementById('map').style.height, '500px');
  assert.ok(harness.scheduler.activeTimeoutDelays().includes(500));

  harness.scheduler.runNextTimeout(500);
  assert.equal(activeFrameIndex(card), 0);

  setConnected(card, false);
});

test('applies restart_delay after displaying the final animation frame', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig({ frame_count: 3, frame_delay: 500, restart_delay: 1700 }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 3);

  assert.equal(activeFrameIndex(card), 2);
  harness.scheduler.runNextTimeout(500);
  assert.equal(activeFrameIndex(card), 0);
  harness.scheduler.runNextTimeout(500);
  assert.equal(activeFrameIndex(card), 1);
  harness.scheduler.runNextTimeout(500);
  assert.equal(activeFrameIndex(card), 2);

  const animationDelays = harness.scheduler.activeTimeoutDelays().filter((delay) => delay !== 300);
  assert.deepEqual(animationDelays, [1700]);

  setConnected(card, false);
});

test('auto basemap keeps its current style without sun data and restarts on day-night transitions', async () => {
  const harness = createHarness();
  const card = new harness.Card();
  card.setConfig(issueConfig({ basemap_style: 'auto', dark_basemap: false }));
  card.hass = issueHass();
  setConnected(card, true);
  await flushUntil(() => timeline(card)?.children.length === 9);

  const firstMap = harness.leafletState.maps[0];
  assert.match(harness.leafletState.tileLayerCalls[0].url, /basemap_default/);

  card.hass = issueHass({ 'sensor.unrelated': { state: 'on' } });
  await Promise.resolve();
  assert.equal(harness.leafletState.maps.length, 1);
  assert.equal(firstMap.removed, false);

  card.hass = issueHass({ 'sun.sun': { state: 'below_horizon', attributes: {} } });
  await flushUntil(() => harness.leafletState.maps.length === 2 && timeline(card)?.children.length === 9);
  assert.equal(firstMap.removed, true);
  assert.match(harness.leafletState.tileLayerCalls[1].url, /basemap_dark/);

  const nightMap = harness.leafletState.maps[1];
  card.hass = issueHass();
  await Promise.resolve();
  assert.equal(harness.leafletState.maps.length, 2);
  assert.equal(nightMap.removed, false);

  card.hass = issueHass({ 'sun.sun': { state: 'above_horizon', attributes: {} } });
  await flushUntil(() => harness.leafletState.maps.length === 3 && timeline(card)?.children.length === 9);
  assert.equal(nightMap.removed, true);
  assert.match(harness.leafletState.tileLayerCalls[2].url, /basemap_default/);

  setConnected(card, false);
});

test('duplicate bundle evaluation preserves existing custom elements and card metadata', () => {
  const harness = createHarness();
  assert.deepEqual(harness.customElements.defineAttempts, ['bom-radar-card', 'bom-radar-card-editor']);
  assert.equal(harness.window.customCards.length, 1);

  // Simulate the registry race where get() misses an existing definition but
  // define() observes it. Browsers report this duplicate-name error.
  harness.customElements.hideNextGet('bom-radar-card');
  harness.customElements.hideNextGet('bom-radar-card-editor');
  assert.doesNotThrow(() => evaluateLifecycleBundle(harness.sandbox));

  assert.deepEqual(harness.customElements.defineAttempts, [
    'bom-radar-card',
    'bom-radar-card-editor',
    'bom-radar-card',
    'bom-radar-card-editor',
  ]);
  assert.equal(harness.window.customCards.length, 1);
  assert.equal(harness.customElements.get('bom-radar-card'), harness.Card);
});
