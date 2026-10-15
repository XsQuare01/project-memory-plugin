/** 사용자에게 한 줄로 보일 오류. code 는 프로세스 종료 코드다. */
export class PmError extends Error {
  constructor(message, code = 1) {
    super(message)
    this.code = code
  }
}
