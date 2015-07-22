declare module 'tough-cookie' {
  interface Cookie {
    toString (): string
  }

  interface SetCookieOptions {
    http?: boolean
    secure?: boolean
    now?: Date
    ignoreError?: boolean
  }

  interface GetCookieOptions {
    http?: boolean
    secure?: boolean
    now?: Date
    expire?: boolean
    allPaths?: boolean
  }

  export class CookieJar {
    constructor (store?: any, rejectPublicSuffixes?: boolean)
    rejectPublicSuffixes: boolean
    setCookie (cookieOrString: string | Cookie, currentUrl: string, cb: (err: Error, cookie?: Cookie) => any): void
    setCookie (cookieOrString: string | Cookie, currentUrl: string, options: SetCookieOptions, cb: (err: Error, cookie?: Cookie) => any): void
    getCookies (currentUrl: string, cb: (err: Error, cookies?: Cookie[]) => any): void
    getCookies (currentUrl: string, options: GetCookieOptions, cb: (err: Error, cookies?: Cookie[]) => any): void
  }
}
