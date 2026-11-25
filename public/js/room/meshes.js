// Procedural geometry: rounded boxes, cylinders, speaker cones, tori, planes.
// Each builder returns { pos: Float32Array, nor: Float32Array, uv: Float32Array, idx: Uint16Array|Uint32Array }.

function finish(pos, nor, uv, idx) {
  const n = pos.length / 3;
  return {
    pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv),
    idx: n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
  };
}

/** Box with rounded edges; corner samples are spread so the curvature stays smooth. */
export function roundedBox(w, h, d, r = 0.02, seg = 4) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  r = Math.min(r, hx * 0.999, hy * 0.999, hz * 0.999);
  const axis = (half) => {
    const out = [];
    for (let k = seg; k >= 0; k--) out.push(-half + r - r * Math.tan((Math.PI / 4) * (k / seg)));
    for (let k = 0; k <= seg; k++) out.push(half - r + r * Math.tan((Math.PI / 4) * (k / seg)));
    return out;
  };
  const ax = { x: axis(hx), y: axis(hy), z: axis(hz) };
  const pos = [], nor = [], uv = [], idx = [];
  // face: normal axis n with sign s, spanning axes a (u) and b (v)
  const faces = [
    ['x', 1, 'z', 'y'], ['x', -1, 'z', 'y'], ['y', 1, 'x', 'z'], ['y', -1, 'x', 'z'], ['z', 1, 'x', 'y'], ['z', -1, 'x', 'y'],
  ];
  const H = { x: hx, y: hy, z: hz };
  for (const [n, s, a, b] of faces) {
    const A = ax[a], B = ax[b];
    const base = pos.length / 3;
    for (let j = 0; j < B.length; j++) {
      for (let i = 0; i < A.length; i++) {
        const p = { x: 0, y: 0, z: 0 };
        p[n] = s * H[n];
        p[a] = A[i];
        p[b] = B[j];
        const inner = {
          x: Math.max(-hx + r, Math.min(hx - r, p.x)),
          y: Math.max(-hy + r, Math.min(hy - r, p.y)),
          z: Math.max(-hz + r, Math.min(hz - r, p.z)),
        };
        let nx = p.x - inner.x, ny = p.y - inner.y, nz = p.z - inner.z;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        pos.push(inner.x + nx * r, inner.y + ny * r, inner.z + nz * r);
        nor.push(nx, ny, nz);
        uv.push((A[i] + H[a]) / (2 * H[a]), (B[j] + H[b]) / (2 * H[b]));
      }
    }
    const W = A.length;
    for (let j = 0; j < B.length - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const q = base + j * W + i;
        // keep outward winding for each face orientation
        const flip = (n === 'x' && s > 0) || (n === 'y' && s > 0) || (n === 'z' && s < 0);
        if (!flip) idx.push(q, q + 1, q + W, q + 1, q + W + 1, q + W);
        else idx.push(q, q + W, q + 1, q + 1, q + W, q + W + 1);
      }
    }
  }
  return finish(pos, nor, uv, idx);
}

/** Cylinder along +z, centered, with optional caps. */
export function cylinder(r, len, seg = 32, caps = true) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (const z of [-len / 2, len / 2]) {
      pos.push(c * r, s * r, z);
      nor.push(c, s, 0);
      uv.push(i / seg, z > 0 ? 1 : 0);
    }
  }
  for (let i = 0; i < seg; i++) {
    const q = i * 2;
    idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
  }
  if (caps) {
    for (const [z, nz] of [[len / 2, 1], [-len / 2, -1]]) {
      const c0 = pos.length / 3;
      pos.push(0, 0, z);
      nor.push(0, 0, nz);
      uv.push(0.5, 0.5);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
        nor.push(0, 0, nz);
        uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
      }
      for (let i = 0; i < seg; i++) {
        if (nz > 0) idx.push(c0, c0 + 1 + i, c0 + 2 + i);
        else idx.push(c0, c0 + 2 + i, c0 + 1 + i);
      }
    }
  }
  return finish(pos, nor, uv, idx);
}

/** Loudspeaker cone facing +z: shallow cone with a domed dust cap. uv.x = radius (0..1). */
export function speakerCone(R, depth = 0.25, seg = 40, rings = 10) {
  const pos = [], nor = [], uv = [], idx = [];
  const cap = 0.32;
  const prof = (t) => {
    // t = radius fraction. returns z (<= 0 is recessed)
    if (t < cap) return -depth * R * (1 - cap) + R * 0.12 * Math.sqrt(Math.max(0, cap * cap - t * t)) / cap * cap;
    return -depth * R * (1 - t);
  };
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const z = prof(t);
    const dz = (prof(Math.min(1, t + 0.01)) - prof(Math.max(0, t - 0.01))) / (0.02 * R);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(c * t * R, s * t * R, z);
      const nx = -dz * c, ny = -dz * s, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nor.push(nx / l, ny / l, nz / l);
      uv.push(t, i / seg);
    }
  }
  const W = seg + 1;
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < seg; i++) {
      const q = k * W + i;
      idx.push(q, q + W, q + 1, q + 1, q + W, q + W + 1);
    }
  }
  return finish(pos, nor, uv, idx);
}

/** Torus in the xy plane (around z), e.g. a driver surround or trim ring. */
export function torus(R, r, seg = 40, tube = 10) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= tube; j++) {
      const b = (j / tube) * Math.PI * 2;
      const cb = Math.cos(b), sb = Math.sin(b);
      pos.push((R + r * cb) * ca, (R + r * cb) * sa, r * sb);
      nor.push(cb * ca, cb * sa, sb);
      uv.push(i / seg, j / tube);
    }
  }
  const W = tube + 1;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < tube; j++) {
      const q = i * W + j;
      idx.push(q, q + W, q + 1, q + 1, q + W, q + W + 1);
    }
  }
  return finish(pos, nor, uv, idx);
}

/** Plane in xz (normal +y), w x d, uv in meters. */
export function plane(w, d) {
  const pos = [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2];
  const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const uv = [0, 0, w, 0, w, d, 0, d];
  return finish(pos, nor, uv, [0, 2, 1, 0, 3, 2]);
}

/** Quad in xy (normal +z), w x h, uv 0..1. */
export function quad(w, h) {
  const pos = [-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  return finish(pos, nor, uv, [0, 1, 2, 0, 2, 3]);
}
