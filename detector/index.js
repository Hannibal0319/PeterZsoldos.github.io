const canvas = document.getElementById("canvas");
const gl = canvas.getContext("webgl");
const slider = document.getElementById("angleSlider");
const angleValue = document.getElementById("angleValue");
const btnShapeE = document.getElementById("btnShapeE");
const btnShapeA = document.getElementById("btnShapeA");
const btnShape1 = document.getElementById("btnShape1");
const btnShapeO = document.getElementById("btnShapeO");
const btnShapeSquare = document.getElementById("btnShapeSquare");
const btnShapeTri = document.getElementById("btnShapeTri");
const btnShapePlus = document.getElementById("btnShapePlus");

if (!gl) {
  throw new Error("WebGL not supported in this browser");
}

const centerX = canvas.width / 2;
const centerY = canvas.height / 2;
const viewRadius = 200;

const phantomColor = [0.58, 0.64, 0.72];
const beamColor = [1, 0, 0];
const projectionColor = [0.13, 0.77, 0.37];
const baselineColor = [0.39, 0.45, 0.55];

const vertexShaderSource = `
attribute vec2 a_position;
attribute vec3 a_color;
varying vec3 v_color;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_color = a_color;
}
`;

const fragmentShaderSource = `
precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "Shader compile failed");
  }
  return shader;
}

function createProgram(vsSource, fsSource) {
  const vs = compileShader(gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || "Program link failed");
  }
  return program;
}

const program = createProgram(vertexShaderSource, fragmentShaderSource);
gl.useProgram(program);

const positionLoc = gl.getAttribLocation(program, "a_position");
const colorLoc = gl.getAttribLocation(program, "a_color");
const buffer = gl.createBuffer();

gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.enableVertexAttribArray(positionLoc);
gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(colorLoc);
gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 20, 8);

function toNdc(x, y) {
  const ndcX = (x / canvas.width) * 2 - 1;
  const ndcY = 1 - (y / canvas.height) * 2;
  return [ndcX, ndcY];
}

function pushLine(out, x1, y1, x2, y2, color) {
  const [ax, ay] = toNdc(x1, y1);
  const [bx, by] = toNdc(x2, y2);
  out.push(ax, ay, color[0], color[1], color[2]);
  out.push(bx, by, color[0], color[1], color[2]);
}

function pushQuad(out, x1, y1, x2, y2, color) {
  const [ax, ay] = toNdc(x1, y1);
  const [bx, by] = toNdc(x2, y2);
  const [cx, cy] = toNdc(x1, y2);
  const [dx, dy] = toNdc(x2, y1);
  // two triangles (a, c, b) and (a, b, d)
  out.push(ax, ay, ...color);
  out.push(cx, cy, ...color);
  out.push(bx, by, ...color);
  out.push(ax, ay, ...color);
  out.push(bx, by, ...color);
  out.push(dx, dy, ...color);
}

function pushTriangle(out, x1, y1, x2, y2, x3, y3, color) {
  const [ax, ay] = toNdc(x1, y1);
  const [bx, by] = toNdc(x2, y2);
  const [cx, cy] = toNdc(x3, y3);
  out.push(ax, ay, ...color);
  out.push(bx, by, ...color);
  out.push(cx, cy, ...color);
}

function pushParallelogram(out, p1, p2, p3, p4, color) {
  const [a1, a2] = toNdc(p1[0], p1[1]);
  const [b1, b2] = toNdc(p2[0], p2[1]);
  const [c1, c2] = toNdc(p3[0], p3[1]);
  const [d1, d2] = toNdc(p4[0], p4[1]);
  out.push(a1, a2, ...color);
  out.push(b1, b2, ...color);
  out.push(c1, c2, ...color);
  out.push(a1, a2, ...color);
  out.push(c1, c2, ...color);
  out.push(d1, d2, ...color);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function letterEContains(cx, cy, x, y) {
  const w = 120;
  const h = 240;
  const gap = 40;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const midY = cy;

  const inTopArm = x >= left && x <= right && y >= top && y <= top + gap;
  const inMidArm = x >= left && x <= right && y >= midY - gap / 2 && y <= midY + gap / 2;
  const inBottomArm = x >= left && x <= right && y >= bottom - gap && y <= bottom;
  const inSpine = x >= left && x <= left + gap && y >= top && y <= bottom;
  return inTopArm || inMidArm || inBottomArm || inSpine;
}

function buildLetterEGeometry(cx, cy, color) {
  const verts = [];
  const w = 120;
  const h = 240;
  const gap = 40;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const midY = cy;

  pushQuad(verts, left, top, right, top + gap, color); // top arm
  pushQuad(verts, left, midY - gap / 2, right, midY + gap / 2, color); // middle arm
  pushQuad(verts, left, bottom - gap, right, bottom, color); // bottom arm
  pushQuad(verts, left, top, left + gap, bottom, color); // spine
  return verts;
}

function letterAContains(cx, cy, x, y) {
  const w = 160;
  const h = 240;
  const stroke = 24;
  const crossH = 30;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const apexX = cx;
  const apexY = top;

  const outer = pointInTriangle(x, y, left, bottom, apexX, apexY, right, bottom);

  // carve inner hole
  const inset = stroke * 1.4;
  const inner = pointInTriangle(
    x,
    y,
    left + inset,
    bottom,
    apexX,
    top + inset,
    right - inset,
    bottom
  );

  const inCross = x >= left + w * 0.25 && x <= right - w * 0.25 && y >= cy - crossH / 2 && y <= cy + crossH / 2;
  return (outer && !inner) || inCross;
}

function buildLetterAGeometry(cx, cy, color) {
  const verts = [];
  const w = 160;
  const h = 240;
  const stroke = 24;
  const crossH = 30;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;

  // left leg
  pushParallelogram(
    verts,
    [left, bottom],
    [cx - stroke * 0.4, top + stroke * 0.5],
    [cx + stroke * 0.4, top + stroke * 0.5 + stroke],
    [left + stroke, bottom],
    color
  );

  // right leg
  pushParallelogram(
    verts,
    [cx - stroke * 0.4, top + stroke * 0.5],
    [right, bottom],
    [right - stroke, bottom],
    [cx + stroke * 0.4, top + stroke * 0.5 + stroke],
    color
  );

  // crossbar
  pushQuad(verts, left + w * 0.25, cy - crossH / 2, right - w * 0.25, cy + crossH / 2, color);
  return verts;
}

function numberOneContains(cx, cy, x, y) {
  const w = 140;
  const h = 240;
  const barW = w * 0.38;
  const baseH = w * 0.22;
  const capH = w * 0.18;
  const capW = w * 0.65;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;

  const inVertical = x >= cx - barW / 2 && x <= cx + barW / 2 && y >= top + capH && y <= bottom;
  const inBase = x >= left && x <= right && y >= bottom - baseH && y <= bottom;
  const inCap = x >= cx - capW / 2 && x <= cx + capW / 2 && y >= top && y <= top + capH;
  return inVertical || inBase || inCap;
}

function buildNumberOneGeometry(cx, cy, color) {
  const verts = [];
  const w = 140;
  const h = 240;
  const barW = w * 0.38;
  const baseH = w * 0.22;
  const capH = w * 0.18;
  const capW = w * 0.65;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;

  pushQuad(verts, cx - barW / 2, top + capH, cx + barW / 2, bottom, color);
  pushQuad(verts, left, bottom - baseH, right, bottom, color);
  pushQuad(verts, cx - capW / 2, top, cx + capW / 2, top + capH, color);
  return verts;
}

function circleContains(cx, cy, x, y) {
  const r = 110;
  const dx = x - cx;
  const dy = y - cy;
  const dist2 = dx * dx + dy * dy;
  const inner = (r - 28) * (r - 28);
  return dist2 <= r * r && dist2 >= inner;
}

function buildCircleGeometry(cx, cy, color) {
  const verts = [];
  const segments = 96;
  const rOuter = 110;
  const rInner = 82;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0o = cx + Math.cos(a0) * rOuter;
    const y0o = cy + Math.sin(a0) * rOuter;
    const x1o = cx + Math.cos(a1) * rOuter;
    const y1o = cy + Math.sin(a1) * rOuter;
    const x0i = cx + Math.cos(a0) * rInner;
    const y0i = cy + Math.sin(a0) * rInner;
    const x1i = cx + Math.cos(a1) * rInner;
    const y1i = cy + Math.sin(a1) * rInner;
    pushTriangle(verts, x0o, y0o, x1o, y1o, x0i, y0i, color);
    pushTriangle(verts, x0i, y0i, x1o, y1o, x1i, y1i, color);
  }
  return verts;
}

function squareContains(cx, cy, x, y) {
  const size = 180;
  const half = size / 2;
  return x >= cx - half && x <= cx + half && y >= cy - half && y <= cy + half;
}

function buildSquareGeometry(cx, cy, color) {
  const size = 180;
  const half = size / 2;
  const verts = [];
  pushQuad(verts, cx - half, cy - half, cx + half, cy + half, color);
  return verts;
}

function triangleContains(cx, cy, x, y) {
  const w = 200;
  const h = 200;
  const leftX = cx - w / 2;
  const rightX = cx + w / 2;
  const topY = cy - h / 2;
  const bottomY = cy + h / 2;
  return pointInTriangle(x, y, leftX, bottomY, cx, topY, rightX, bottomY);
}

function buildTriangleGeometry(cx, cy, color) {
  const w = 200;
  const h = 200;
  const verts = [];
  pushTriangle(verts, cx - w / 2, cy + h / 2, cx, cy - h / 2, cx + w / 2, cy + h / 2, color);
  return verts;
}

function plusContains(cx, cy, x, y) {
  const arm = 160;
  const thickness = 50;
  const hx = arm / 2;
  const hy = arm / 2;
  const t = thickness / 2;
  const inVertical = x >= cx - t && x <= cx + t && y >= cy - hy && y <= cy + hy;
  const inHorizontal = y >= cy - t && y <= cy + t && x >= cx - hx && x <= cx + hx;
  return inVertical || inHorizontal;
}

function buildPlusGeometry(cx, cy, color) {
  const arm = 160;
  const thickness = 50;
  const hx = arm / 2;
  const hy = arm / 2;
  const t = thickness / 2;
  const verts = [];
  // vertical bar
  pushQuad(verts, cx - t, cy - hy, cx + t, cy + hy, color);
  // horizontal bar
  pushQuad(verts, cx - hx, cy - t, cx + hx, cy + t, color);
  return verts;
}

function lineIntegralForShape(cx, cy, shapeFunc, x0, y0, dx, dy) {
  const steps = 100;
  let integral = 0;
  const length = 1000;

  for (let i = -steps; i <= steps; i++) {
    const t = (i / steps) * length;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    if (shapeFunc(cx, cy, x, y)) {
      integral += 1;
    }
  }
  return integral / steps;
}

function drawArrays(data, mode) {
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
  gl.drawArrays(mode, 0, data.length / 5);
}

const shapes = {
  E: { buildGeometry: buildLetterEGeometry, contains: letterEContains, button: btnShapeE },
  A: { buildGeometry: buildLetterAGeometry, contains: letterAContains, button: btnShapeA },
  "1": { buildGeometry: buildNumberOneGeometry, contains: numberOneContains, button: btnShape1 },
  O: { buildGeometry: buildCircleGeometry, contains: circleContains, button: btnShapeO },
  Square: { buildGeometry: buildSquareGeometry, contains: squareContains, button: btnShapeSquare },
  Tri: { buildGeometry: buildTriangleGeometry, contains: triangleContains, button: btnShapeTri },
  Plus: { buildGeometry: buildPlusGeometry, contains: plusContains, button: btnShapePlus }
};

let currentShapeKey = "E";
let phantomGeometry = shapes[currentShapeKey].buildGeometry(centerX, centerY, phantomColor);
let currentAngle = parseFloat(slider.value) || 0;

function setActiveButton(key) {
  Object.keys(shapes).forEach(shapeKey => {
    const btn = shapes[shapeKey].button;
    if (btn) {
      btn.classList.toggle("active", shapeKey === key);
    }
  });
}

function changeShape(key) {
  if (!shapes[key]) return;
  currentShapeKey = key;
  phantomGeometry = shapes[key].buildGeometry(centerX, centerY, phantomColor);
  setActiveButton(key);
  draw(currentAngle);
}

function draw(angleDeg) {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // draw phantom once per frame
  drawArrays(phantomGeometry, gl.TRIANGLES);

  const angle = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -Math.sin(angle);
  const py = Math.cos(angle);

  const count = 60;
  const spacing = (viewRadius * 2) / count;
  const beamLength = 200;
  const detectorDistance = viewRadius;

  const projections = [];
  const detectorPoints = [];
  const beamVerts = [];
  const containsFunc = shapes[currentShapeKey].contains;

  for (let i = -count; i <= count; i++) {
    const offset = i * spacing * 0.5;
    const cx = centerX + px * offset;
    const cy = centerY + py * offset;

    const x1 = cx - dx * beamLength;
    const y1 = cy - dy * beamLength;
    const x2 = cx + dx * beamLength;
    const y2 = cy + dy * beamLength;

    pushLine(beamVerts, x1, y1, x2, y2, beamColor);

  const L1 = lineIntegralForShape(centerX, centerY, containsFunc, x1, y1, dx, dy);
    projections.push(L1);

    const detX = centerX + dx * detectorDistance + px * offset;
    const detY = centerY + dy * detectorDistance + py * offset;
    detectorPoints.push({ x: detX, y: detY });
  }

  drawArrays(beamVerts, gl.LINES);

  const maxProj = Math.max(...projections) || 1;
  const projectionVerts = [];

  for (let i = 0; i < detectorPoints.length; i++) {
    const p = projections[i] / maxProj;
    const base = detectorPoints[i];
    const length = 80 * p;
    const x2 = base.x + dx * length;
    const y2 = base.y + dy * length;
    pushLine(projectionVerts, base.x, base.y, x2, y2, projectionColor);
  }

  drawArrays(projectionVerts, gl.LINES);

  const baselineVerts = [];
  const first = detectorPoints[0];
  const last = detectorPoints[detectorPoints.length - 1];
  pushLine(baselineVerts, first.x, first.y, last.x, last.y, baselineColor);
  drawArrays(baselineVerts, gl.LINES);
}

slider.addEventListener("input", () => {
  currentAngle = parseFloat(slider.value) || 0;
  angleValue.textContent = currentAngle;
  draw(currentAngle);
});

btnShapeE.addEventListener("click", () => changeShape("E"));
btnShapeA.addEventListener("click", () => changeShape("A"));
btnShape1.addEventListener("click", () => changeShape("1"));
btnShapeO.addEventListener("click", () => changeShape("O"));
btnShapeSquare.addEventListener("click", () => changeShape("Square"));
btnShapeTri.addEventListener("click", () => changeShape("Tri"));
btnShapePlus.addEventListener("click", () => changeShape("Plus"));

setActiveButton(currentShapeKey);
draw(currentAngle);