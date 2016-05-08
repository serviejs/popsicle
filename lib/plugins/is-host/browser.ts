export default function isHostObject (object: any) {
  const str = Object.prototype.toString.call(object)

  switch (str) {
    case '[object File]':
    case '[object Blob]':
    case '[object FormData]':
    case '[object ArrayBuffer]':
      return true
    default:
      return false
  }
}