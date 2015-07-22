declare module 'concat-stream' {
  import { Writable } from 'stream'

  function concatStream (cb: (data: any) => any): Writable
  function concatStream (opts: { encoding: string }, cb: (data: any) => any): Writable

  export = concatStream
}
