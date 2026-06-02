// WebGL2 Voronoi-inspired grid engine for the Discover page.
// Uses OGL for WebGL2. Renders movie poster cells as textured quads
// in a force-relaxed grid layout. Supports pan/zoom and hover detection.

import { Renderer, Camera, Transform, Program, Mesh, Geometry, Texture, Vec2 } from 'ogl';
import { VERT, FRAG, HOVER_VERT, HOVER_FRAG } from './shaders.js';

const IMG_BASE = 'https://image.tmdb.org/t/p/w185';
const CELL_ASPECT = 2 / 3; // poster ratio width/height

export class DiscoverEngine {
  constructor(canvas, films, { onHover, onSelect } = {}) {
    this.canvas = canvas;
    this.films = films;
    this.onHover = onHover || (() => {});
    this.onSelect = onSelect || (() => {});
    this._destroyed = false;
    this._hoveredIdx = -1;
    this._textures = {};
    this._rafId = null;
    this._time = 0;

    this._init();
  }

  _init() {
    const { canvas } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new Renderer({ canvas, dpr, alpha: true, antialias: false });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0.04, 0.04, 0.04, 1);

    this.camera = new Camera(this.gl, { near: 0.1, far: 100 });
    this.camera.position.set(0, 0, 1);

    this.scene = new Transform();

    // Pan/zoom state in world units
    this._pan = new Vec2(0, 0);
    this._zoom = 1.0;
    this._targetPan = new Vec2(0, 0);
    this._targetZoom = 1.0;

    this._buildGrid();
    this._buildMeshes();
    this._bindEvents();
    this._resize();
    this._loop();
  }

  _buildGrid() {
    const count = this.films.length;
    const cols = Math.ceil(Math.sqrt(count / CELL_ASPECT));
    const rows = Math.ceil(count / cols);
    const cellW = 120; // world units
    const cellH = cellW / CELL_ASPECT;
    const gap = 8;

    this._cols = cols;
    this._rows = rows;
    this._cellW = cellW;
    this._cellH = cellH;

    // Grid positions with slight force jitter
    this._positions = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - cols / 2) * (cellW + gap) + (Math.random() - 0.5) * 4;
      const y = (row - rows / 2) * (cellH + gap) + (Math.random() - 0.5) * 4;
      this._positions.push([x, y]);
    }

    // Simple force relaxation — push overlapping cells apart
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = this._positions[j][0] - this._positions[i][0];
          const dy = this._positions[j][1] - this._positions[i][1];
          const minDist = (cellW + gap) * 0.95;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist && dist > 0) {
            const push = (minDist - dist) / dist * 0.5;
            this._positions[i][0] -= dx * push * 0.3;
            this._positions[i][1] -= dy * push * 0.3;
            this._positions[j][0] += dx * push * 0.3;
            this._positions[j][1] += dy * push * 0.3;
          }
        }
      }
    }
  }

  _buildMeshes() {
    const { gl } = this;
    const count = this.films.length;

    // One quad geometry shared across all cells (instanced-style via per-cell draw)
    // For simplicity: one mesh per cell. For 2000 films this is fine in WebGL2.
    // Each cell: 2 triangles = 6 vertices
    const quadVerts = new Float32Array([
      -1, -1,  0, 1,   // BL
       1, -1,  1, 1,   // BR
       1,  1,  1, 0,   // TR
      -1, -1,  0, 1,   // BL
       1,  1,  1, 0,   // TR
      -1,  1,  0, 0,   // TL
    ]);

    this._program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTexture: { value: new Texture(gl) },
        uHasTexture: { value: 0 },
        uFallbackColor: { value: [0.15, 0.15, 0.18] },
        uBorderRadius: { value: 0.04 },
        uViewMatrix: { value: new Float32Array(9) },
      },
      transparent: true,
      depthTest: false,
    });

    this._hoverProgram = new Program(gl, {
      vertex: HOVER_VERT,
      fragment: HOVER_FRAG,
      uniforms: {
        uViewMatrix: { value: new Float32Array(9) },
        uCenter: { value: [0, 0] },
        uSize: { value: this._cellW },
        uTime: { value: 0 },
      },
      transparent: true,
      depthTest: false,
    });

    // Build geometry arrays for all cells
    const positions = [];
    const uvs = [];
    const cellCenters = [];
    const cellSizes = [];
    const cellAlphas = [];

    for (let i = 0; i < count; i++) {
      // 6 verts per quad
      for (let v = 0; v < 6; v++) {
        const px = quadVerts[v * 4];
        const py = quadVerts[v * 4 + 1];
        const u = quadVerts[v * 4 + 2];
        const vv = quadVerts[v * 4 + 3];
        positions.push(px, py);
        uvs.push(u, vv);
        cellCenters.push(this._positions[i][0], this._positions[i][1]);
        cellSizes.push(this._cellW);
        cellAlphas.push(1.0);
      }
    }

    this._geom = new Geometry(gl, {
      position: { size: 2, data: new Float32Array(positions) },
      uv: { size: 2, data: new Float32Array(uvs) },
      cellCenter: { size: 2, data: new Float32Array(cellCenters) },
      cellSize: { size: 1, data: new Float32Array(cellSizes) },
      cellAlpha: { size: 1, data: new Float32Array(cellAlphas) },
    });

    this._mesh = new Mesh(gl, { geometry: this._geom, program: this._program });

    // Hover quad geometry (single quad)
    this._hoverGeom = new Geometry(gl, {
      position: {
        size: 2,
        data: new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]),
      },
    });
    this._hoverMesh = new Mesh(gl, { geometry: this._hoverGeom, program: this._hoverProgram });

    // Kick off texture loading in background
    this._loadTextures();
  }

  _loadTextures() {
    const { gl } = this;
    const BATCH = 20;
    let idx = 0;

    const loadNext = () => {
      if (this._destroyed) return;
      const end = Math.min(idx + BATCH, this.films.length);
      for (let i = idx; i < end; i++) {
        const film = this.films[i];
        if (!film.poster_path) continue;
        const url = `${IMG_BASE}${film.poster_path}`;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (this._destroyed) return;
          const tex = new Texture(gl, { image: img, generateMipmaps: true });
          this._textures[i] = tex;
        };
        img.src = url;
      }
      idx = end;
      if (idx < this.films.length) {
        setTimeout(loadNext, 100);
      }
    };
    loadNext();
  }

  // Build a 3x3 view matrix encoding pan + zoom for the shaders
  _buildViewMatrix() {
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    const sx = (2 * this._zoom) / w;
    const sy = (2 * this._zoom) / h;
    const tx = -this._pan.x * sx;
    const ty = -this._pan.y * sy;
    return new Float32Array([
      sx, 0, 0,
      0, sy, 0,
      tx, ty, 1,
    ]);
  }

  _loop() {
    if (this._destroyed) return;
    this._rafId = requestAnimationFrame(() => this._loop());
    this._time += 0.016;

    // Smooth pan/zoom
    this._pan.x += (this._targetPan.x - this._pan.x) * 0.12;
    this._pan.y += (this._targetPan.y - this._pan.y) * 0.12;
    this._zoom += (this._targetZoom - this._zoom) * 0.12;

    this._render();
  }

  _render() {
    const { gl, renderer } = this;
    const viewMatrix = this._buildViewMatrix();

    renderer.render({ scene: this.scene });
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw all cells, each with its own texture if loaded
    const vertsPerCell = 6;
    const count = this.films.length;

    for (let i = 0; i < count; i++) {
      const tex = this._textures[i];
      this._program.uniforms.uViewMatrix.value = viewMatrix;
      this._program.uniforms.uHasTexture.value = tex ? 1 : 0;
      if (tex) this._program.uniforms.uTexture.value = tex;

      // Draw just this cell's 6 verts
      this._program.use();
      this._geom.draw({ mode: gl.TRIANGLES, first: i * vertsPerCell, count: vertsPerCell });
    }

    // Draw hover highlight
    if (this._hoveredIdx >= 0) {
      const [cx, cy] = this._positions[this._hoveredIdx];
      this._hoverProgram.uniforms.uViewMatrix.value = viewMatrix;
      this._hoverProgram.uniforms.uCenter.value = [cx, cy];
      this._hoverProgram.uniforms.uSize.value = this._cellW;
      this._hoverProgram.uniforms.uTime.value = this._time;
      this._hoverProgram.use();
      this._hoverGeom.draw({ mode: gl.TRIANGLES });
    }
  }

  // Convert screen coords to world coords
  _screenToWorld(sx, sy) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const nx = (sx / w) * 2 - 1;
    const ny = 1 - (sy / h) * 2;
    return {
      x: nx / this._zoom + this._pan.x,
      y: ny / this._zoom + this._pan.y,
    };
  }

  _hitTest(worldX, worldY) {
    const hw = this._cellW / 2;
    const hh = this._cellH / 2;
    for (let i = 0; i < this._positions.length; i++) {
      const [cx, cy] = this._positions[i];
      if (
        worldX >= cx - hw && worldX <= cx + hw &&
        worldY >= cy - hh && worldY <= cy + hh
      ) return i;
    }
    return -1;
  }

  _bindEvents() {
    const el = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    let dragDist = 0;

    const onMouseMove = (e) => {
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        this._targetPan.x -= dx / this._zoom;
        this._targetPan.y += dy / this._zoom;
        dragDist += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX;
        lastY = e.clientY;
      }

      const world = this._screenToWorld(sx, sy);
      const idx = this._hitTest(world.x, world.y);
      if (idx !== this._hoveredIdx) {
        this._hoveredIdx = idx;
        this.onHover(idx >= 0 ? { film: this.films[idx], screenX: e.clientX, screenY: e.clientY } : null);
      }
    };

    const onMouseDown = (e) => {
      dragging = true;
      dragDist = 0;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onMouseUp = (e) => {
      dragging = false;
      if (dragDist < 4 && this._hoveredIdx >= 0) {
        this.onSelect(this.films[this._hoveredIdx]);
      }
    };

    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      this._targetZoom = Math.max(0.08, Math.min(6, this._targetZoom * factor));
    };

    // Touch support
    let lastTouchDist = 0;
    let lastTouchX = 0, lastTouchY = 0;
    let touchDragDist = 0;

    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        touchDragDist = 0;
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchX;
        const dy = e.touches[0].clientY - lastTouchY;
        this._targetPan.x -= dx / this._zoom;
        this._targetPan.y += dy / this._zoom;
        touchDragDist += Math.abs(dx) + Math.abs(dy);
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const factor = dist / lastTouchDist;
        this._targetZoom = Math.max(0.08, Math.min(6, this._targetZoom * factor));
        lastTouchDist = dist;
      }
    };

    const onTouchEnd = (e) => {
      if (e.changedTouches.length === 1 && touchDragDist < 10) {
        const rect = el.getBoundingClientRect();
        const sx = e.changedTouches[0].clientX - rect.left;
        const sy = e.changedTouches[0].clientY - rect.top;
        const world = this._screenToWorld(sx, sy);
        const idx = this._hitTest(world.x, world.y);
        if (idx >= 0) this.onSelect(this.films[idx]);
      }
    };

    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    this._cleanup = () => {
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }

  _resize() {
    const { canvas } = this;
    const w = canvas.parentElement?.clientWidth || window.innerWidth;
    const h = canvas.parentElement?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
  }

  handleResize() {
    this._resize();
  }

  destroy() {
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._cleanup) this._cleanup();
  }
}
