import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, splitArgs, commandArgs } from './utils.js';

test('parseNumber', () => {
  assert.equal(parseNumber('1500'), 1500);
  assert.equal(parseNumber('1.500'), 1500);
  assert.equal(parseNumber('1.500,50'), 1500.5);
  assert.equal(parseNumber('1,500.50'), 1500.5);
  assert.equal(parseNumber('2,5'), 2.5);
  assert.equal(parseNumber('2.5'), 2.5);
  assert.equal(parseNumber('$ 12.000'), 12000);
  assert.equal(parseNumber('+3'), 3);
  assert.equal(parseNumber('-2'), -2);
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.ok(Number.isNaN(parseNumber('')));
});

test('args', () => {
  assert.equal(commandArgs('/venta@MiBot remera | 2'), 'remera | 2');
  assert.deepEqual(splitArgs('Remera negra | 10 ; 5000|9000'), ['Remera negra', '10', '5000', '9000']);
  assert.deepEqual(splitArgs('  '), []);
});
