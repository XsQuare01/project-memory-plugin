import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function randomToken() {
  return randomBytes(12).toString('hex')
}

/** 같은 폴더의 임시 파일에 쓴 뒤 이름 바꾸기로 교체한다. 읽는 쪽이 반쯤 쓴 파일을 보지 않는다. */
export function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomToken()}`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

export function readIfExists(path) {
  try {
    return readFileSync(path)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export function writeJson(path, value) {
  atomicWrite(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`))
}

export function readJson(path, fallback) {
  const buf = readIfExists(path)
  return buf === null ? fallback : JSON.parse(buf.toString('utf8'))
}
