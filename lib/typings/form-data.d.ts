declare module 'form-data' {
  class FormData {
    append (key: string, value: any): FormData
    getHeaders (): Object
    pipe (to: any): any
  }

  export = FormData
}
