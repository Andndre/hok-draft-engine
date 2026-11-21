import test from 'node:test';
import assert from 'node:assert/strict';
import { renderColoredText } from '../src/components/ColoredText.tsx';

test('renderColoredText returns plain text when no markup exists', () => {
  const input = 'Deals 500 Physical Damage to nearby enemies.';
  const result = renderColoredText(input);
  assert.equal(result, input);
});

test('renderColoredText parses single and multiple color tags correctly', () => {
  const input = 'Basic Attack hits place <color=#2dc6ff>marks</color> on the target. At max marks, <color=#ff6600>damage</color> is dealt to them.';
  const result = renderColoredText(input);
  assert.ok(Array.isArray(result), 'Must return an array of elements/strings');
  assert.equal(result.length, 5);

  assert.equal(result[0], 'Basic Attack hits place ');
  assert.equal(result[1].props.style.color, '#2dc6ff');
  assert.equal(result[1].props.children, 'marks');
  assert.equal(result[2], ' on the target. At max marks, ');
  assert.equal(result[3].props.style.color, '#ff6600');
  assert.equal(result[3].props.children, 'damage');
  assert.equal(result[4], ' is dealt to them.');
});

test('renderColoredText normalizes hex codes without leading #', () => {
  const input = 'Gains <color=6bc872>Movement Speed</color>.';
  const result = renderColoredText(input);
  assert.ok(Array.isArray(result));
  assert.equal(result[1].props.style.color, '#6bc872');
  assert.equal(result[1].props.children, 'Movement Speed');
});
