declare namespace NodeJS {
  interface Process {
    browser: boolean
  }
}

declare module 'http' {
  interface ClientRequest {
    getHeader (name: string): string
  }
}

interface XMLHttpRequest {
  responseURL: string
}
