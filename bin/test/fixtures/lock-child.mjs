// 잠금 경쟁 테스트용 자식 프로세스: 잠금을 잡고, 잡은 동안 owner.json 이 계속 자기 것인지 확인한 뒤 푼다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireLock, releaseLock } from '../../lib/lock.mjs'

const [root, holdMs] = process.argv.slice(2)
const ownerPath = join(root, 'runtime', 'lock', 'owner.json')
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const { token } = acquireLock(root, { agent: 'test', session: String(process.pid) }, { timeoutMs: 15000 })
let ok = JSON.parse(readFileSync(ownerPath, 'utf8')).token === token
for (let i = 0; i < 5 && ok; i++) {
  sleep(Number(holdMs) / 5)
  ok = JSON.parse(readFileSync(ownerPath, 'utf8')).token === token
}
releaseLock(root, token)
process.stdout.write(JSON.stringify({ ok, pid: process.pid }))
