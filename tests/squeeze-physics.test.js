const test = require('node:test');
const assert = require('node:assert/strict');
const SqueezePhysics = require('../squeeze-physics.js');

const REGION_NAMES = SqueezePhysics.REGION_NAMES;

function approx(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);
}

function assertIdentity(pose) {
  for (const name of REGION_NAMES) {
    const region = pose.regions[name];
    approx(region.scaleX, 1);
    approx(region.scaleY, 1);
    approx(region.x, 0);
    approx(region.y, 0);
    approx(region.rotate, 0);
  }
}

test('zero intensity is an exact identity pose', () => {
  assertIdentity(SqueezePhysics.getPose({ x: 180, y: 420, intensity: 0 }));
  assertIdentity(SqueezePhysics.getPose({ x: 17, y: 603, intensity: 0 }));
});

test('body center produces the strongest body squeeze', () => {
  const pose = SqueezePhysics.getPose({ x: 180, y: 420, intensity: 1 });
  const body = pose.regions.body;
  approx(body.scaleX, 0.62);
  approx(body.scaleY, 0.8);
  assert.ok(body.scaleX < pose.regions.leftWing.scaleX);
  assert.ok(body.scaleX < pose.regions.head.scaleX);
});

test('each primary region responds at its anchor', () => {
  const anchors = {
    tail: { x: 70, y: 365 },
    body: { x: 180, y: 420 },
    neck: { x: 180, y: 180 },
    leftWing: { x: 121, y: 362 },
    rightWing: { x: 239, y: 362 },
    head: { x: 180, y: 76 },
    legs: { x: 180, y: 575 }
  };

  for (const name of REGION_NAMES) {
    const region = SqueezePhysics.getPose({ ...anchors[name], intensity: 1 }).regions[name];
    assert.ok(region.scaleX < 1, `${name} should compress horizontally`);
    assert.ok(region.scaleY < 1, `${name} should compress vertically`);
  }
});

test('left and right wings are mirror symmetric', () => {
  const leftPress = SqueezePhysics.getPose({ x: 121, y: 362, intensity: 1 }).regions;
  const rightPress = SqueezePhysics.getPose({ x: 239, y: 362, intensity: 1 }).regions;

  approx(leftPress.leftWing.scaleX, rightPress.rightWing.scaleX, 1e-8);
  approx(leftPress.leftWing.scaleY, rightPress.rightWing.scaleY, 1e-8);
  approx(leftPress.leftWing.x, -rightPress.rightWing.x, 1e-8);
  approx(leftPress.leftWing.y, rightPress.rightWing.y, 1e-8);
  approx(leftPress.leftWing.rotate, -rightPress.rightWing.rotate, 1e-8);
});

test('coordinates are clamped and malformed inputs never produce NaN', () => {
  const pose = SqueezePhysics.getPose({ x: -Infinity, y: 99999, intensity: NaN });
  assert.deepEqual(pose.point, { x: 180, y: 640 });
  assert.equal(pose.intensity, 0);
  for (const name of REGION_NAMES) {
    for (const value of Object.values(pose.regions[name])) assert.ok(Number.isFinite(value));
  }

  const edge = SqueezePhysics.getPose({ x: -100, y: -100, intensity: 200 });
  assert.deepEqual(edge.point, { x: 0, y: 0 });
  assert.equal(edge.intensity, 1);
});

test('compression is monotonic with intensity', () => {
  const low = SqueezePhysics.getPose({ x: 180, y: 420, intensity: 0.2 }).regions.body;
  const medium = SqueezePhysics.getPose({ x: 180, y: 420, intensity: 0.5 }).regions.body;
  const high = SqueezePhysics.getPose({ x: 180, y: 420, intensity: 1 }).regions.body;
  assert.ok(low.scaleX > medium.scaleX && medium.scaleX > high.scaleX);
  assert.ok(low.scaleY > medium.scaleY && medium.scaleY > high.scaleY);
});

test('pose values stay within deformation limits', () => {
  const regions = SqueezePhysics.getPose({ x: 0, y: 640, intensity: 1 }).regions;
  for (const region of Object.values(regions)) {
    assert.ok(region.scaleX >= 0.62 && region.scaleX <= 1);
    assert.ok(region.scaleY >= 0.8 && region.scaleY <= 1);
    assert.ok(Math.abs(region.x) <= 12);
    assert.ok(Math.abs(region.y) <= 12);
    assert.ok(Math.abs(region.rotate) <= 5);
  }
});

test('normalised and percentage intensity have the same pose', () => {
  const normalized = SqueezePhysics.getPose({ x: 210, y: 375, intensity: 0.64 });
  const percentage = SqueezePhysics.getPose({ x: 210, y: 375, intensity: 64 });
  assert.deepEqual(percentage, normalized);
});

test('getPose does not mutate its input or share result state', () => {
  const input = { x: 210, y: 375, intensity: 0.8 };
  const snapshot = { ...input };
  const first = SqueezePhysics.getPose(input);
  first.regions.body.scaleX = 0;
  const second = SqueezePhysics.getPose(input);
  assert.deepEqual(input, snapshot);
  assert.notEqual(second.regions.body.scaleX, 0);
});
