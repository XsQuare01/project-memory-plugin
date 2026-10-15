import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPm, makePmRoot } from './helpers.mjs'

test('인자 없이 부르면 사용법을 보이고 종료 코드 2', () => {
  const r = runPm([], { root: makePmRoot() })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /사용법/)
})

test('모르는 명령이면 그 이름을 짚고 종료 코드 2', () => {
  const r = runPm(['frobnicate'], { root: makePmRoot() })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /frobnicate/)
})
