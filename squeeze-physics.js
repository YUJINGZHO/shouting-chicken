(function initializeSqueezePhysics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SqueezePhysics = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function createSqueezePhysics() {
  'use strict';

  const VIEWBOX = Object.freeze({ width: 360, height: 640 });
  const REGION_NAMES = Object.freeze([
    'tail',
    'body',
    'neck',
    'leftWing',
    'rightWing',
    'head',
    'legs'
  ]);

  // Anchors follow the chicken's 360 x 640 SVG viewBox. The radius describes
  // the soft elliptical area in which a press primarily affects that region.
  const REGION_CONFIG = Object.freeze({
    tail: Object.freeze({ anchor: Object.freeze({ x: 70, y: 365 }), radiusX: 90, radiusY: 82, maxScaleX: 0.16, maxScaleY: 0.10 }),
    body: Object.freeze({ anchor: Object.freeze({ x: 180, y: 420 }), radiusX: 112, radiusY: 178, maxScaleX: 0.38, maxScaleY: 0.20 }),
    neck: Object.freeze({ anchor: Object.freeze({ x: 180, y: 180 }), radiusX: 84, radiusY: 104, maxScaleX: 0.32, maxScaleY: 0.18 }),
    leftWing: Object.freeze({ anchor: Object.freeze({ x: 121, y: 362 }), radiusX: 70, radiusY: 96, maxScaleX: 0.34, maxScaleY: 0.16 }),
    rightWing: Object.freeze({ anchor: Object.freeze({ x: 239, y: 362 }), radiusX: 70, radiusY: 96, maxScaleX: 0.34, maxScaleY: 0.16 }),
    head: Object.freeze({ anchor: Object.freeze({ x: 180, y: 76 }), radiusX: 88, radiusY: 76, maxScaleX: 0.30, maxScaleY: 0.16 }),
    legs: Object.freeze({ anchor: Object.freeze({ x: 180, y: 575 }), radiusX: 92, radiusY: 76, maxScaleX: 0.20, maxScaleY: 0.12 })
  });

  // Neighbour propagation keeps the squeeze feeling rubbery without making
  // every press collapse the whole illustration uniformly.
  const NEIGHBOURS = Object.freeze({
    tail: Object.freeze(['body']),
    body: Object.freeze(['tail', 'neck', 'leftWing', 'rightWing', 'legs']),
    neck: Object.freeze(['body', 'head', 'leftWing', 'rightWing']),
    leftWing: Object.freeze(['body', 'neck']),
    rightWing: Object.freeze(['body', 'neck']),
    head: Object.freeze(['neck']),
    legs: Object.freeze(['body'])
  });
  const PROPAGATION = 0.12;
  const FALLOFF = 2.4;
  const MAX_OFFSET = 12;
  const MAX_ROTATE = 5;

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeIntensity(value) {
    const numeric = finiteOr(Number(value), 0);
    // The application reports percentages while the physics API is naturally
    // normalized. Accept both forms so integrations can pass either safely.
    return clamp(numeric > 1 ? numeric / 100 : numeric, 0, 1);
  }

  function normalizePoint(input) {
    const point = input && typeof input === 'object' ? input : {};
    return {
      x: clamp(finiteOr(Number(point.x), 180), 0, VIEWBOX.width),
      y: clamp(finiteOr(Number(point.y), 420), 0, VIEWBOX.height)
    };
  }

  function primaryInfluence(point, config) {
    const dx = (point.x - config.anchor.x) / config.radiusX;
    const dy = (point.y - config.anchor.y) / config.radiusY;
    return Math.exp(-FALLOFF * (dx * dx + dy * dy));
  }

  function buildInfluences(point) {
    const direct = {};
    REGION_NAMES.forEach((name) => {
      direct[name] = primaryInfluence(point, REGION_CONFIG[name]);
    });

    const influences = {};
    REGION_NAMES.forEach((name) => {
      let propagated = direct[name];
      NEIGHBOURS[name].forEach((neighbour) => {
        propagated += direct[neighbour] * PROPAGATION;
      });
      influences[name] = clamp(propagated, 0, 1);
    });
    return influences;
  }

  function makeRegionPose(point, intensity, influence, config) {
    const effective = clamp(intensity * influence, 0, 1);
    const normalizedX = (point.x - config.anchor.x) / config.radiusX;
    const normalizedY = (point.y - config.anchor.y) / config.radiusY;
    const x = clamp(normalizedX * MAX_OFFSET * effective, -MAX_OFFSET, MAX_OFFSET);
    const y = clamp(normalizedY * MAX_OFFSET * effective, -MAX_OFFSET, MAX_OFFSET);
    const rotate = clamp(normalizedX * MAX_ROTATE * effective, -MAX_ROTATE, MAX_ROTATE);

    return {
      scaleX: 1 - config.maxScaleX * effective,
      scaleY: 1 - config.maxScaleY * effective,
      x,
      y,
      rotate
    };
  }

  function getPose(options) {
    const point = normalizePoint(options);
    const intensity = normalizeIntensity(options && options.intensity);
    const influences = buildInfluences(point);
    const regions = {};

    REGION_NAMES.forEach((name) => {
      regions[name] = makeRegionPose(point, intensity, influences[name], REGION_CONFIG[name]);
    });

    return {
      point,
      intensity,
      regions
    };
  }

  return Object.freeze({
    VIEWBOX,
    REGION_NAMES,
    getPose
  });
});
