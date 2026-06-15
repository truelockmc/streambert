// MIT-licensed GLSL shaders for the Discover WebGL renderer.
// Vertex: positions each cell quad; Fragment: samples the poster texture.

export const VERT = /* glsl */`
attribute vec2 position;
attribute vec2 uv;
attribute vec2 cellCenter;
attribute float cellSize;
attribute float cellAlpha;

uniform mat3 uViewMatrix;

varying vec2 vUv;
varying float vAlpha;

void main() {
  vec2 worldPos = cellCenter + position * cellSize * 0.5;
  vec3 clip = uViewMatrix * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vUv = uv;
  vAlpha = cellAlpha;
}
`;

export const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uTexture;
uniform float uHasTexture;
uniform vec3 uFallbackColor;
uniform float uBorderRadius;

varying vec2 vUv;
varying float vAlpha;

float roundedBox(vec2 uv, float r) {
  vec2 q = abs(uv - 0.5) - (0.5 - r);
  return length(max(q, 0.0)) - r;
}

void main() {
  float d = roundedBox(vUv, uBorderRadius);
  if (d > 0.0) discard;

  vec4 color;
  if (uHasTexture > 0.5) {
    color = texture2D(uTexture, vUv);
  } else {
    color = vec4(uFallbackColor, 1.0);
  }

  gl_FragColor = vec4(color.rgb, color.a * vAlpha);
}
`;

// Hover highlight overlay shader
export const HOVER_VERT = /* glsl */`
attribute vec2 position;

uniform mat3 uViewMatrix;
uniform vec2 uCenter;
uniform float uSize;

void main() {
  vec2 worldPos = uCenter + position * uSize * 0.5;
  vec3 clip = uViewMatrix * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const HOVER_FRAG = /* glsl */`
precision mediump float;
uniform float uTime;

void main() {
  float pulse = 0.7 + 0.3 * sin(uTime * 3.0);
  gl_FragColor = vec4(0.9, 0.1, 0.1, 0.55 * pulse);
}
`;
