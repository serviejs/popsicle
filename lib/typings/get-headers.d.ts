declare module 'get-headers' {
  export interface Headers {
    [headerName: string]: string | string[]
  }

  export function http (res: any): Headers
  export function parse (value: string): Headers
}
