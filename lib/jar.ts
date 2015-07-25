import { CookieJar } from 'tough-cookie'

export default function cookieJar (store?: any) {
  return new CookieJar(store)
}
