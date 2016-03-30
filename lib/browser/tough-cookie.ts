function ToughCookie () {
  throw new TypeError('Cookie jars are only available on node')
}

export class CookieJar {
  constructor() {
    ToughCookie();
  }
}

export default ToughCookie;
