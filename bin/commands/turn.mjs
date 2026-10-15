import { runHook } from '../lib/hook-io.mjs'
import { turnFor } from '../lib/hooks.mjs'

/** 턴 시작 훅: stdin 의 훅 JSON → stdout 의 훅 JSON. 어떤 오류에도 종료 코드 0. */
export async function run(argv) {
  return runHook(argv, 'UserPromptSubmit', turnFor)
}
