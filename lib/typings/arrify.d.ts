declare module 'arrify' {
  function arrify <T> (value: T | T[]): T[]

  export = arrify
}
