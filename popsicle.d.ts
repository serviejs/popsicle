declare module 'popsicle' {
  function popsicle (options: popsicle.Options): popsicle.Request;

  module popsicle {
    interface PopsicleOptions {
      url: string;
      method?: string;
      body?: any;
      query?: string | QueryMap;
      timeout?: number;
      headers?: HeaderMap;
      jar?: CookieJar;
      maxRedirects?: number;
      rejectUnauthorized?: boolean;
      agent?: any;
      stream?: boolean;
      raw?: boolean;
      encoding?: string;
      withCredentials?: boolean;
      parse?: boolean;
    }

    type Options = string | PopsicleOptions;

    interface QueryMap {
      [key: string]: string;
    }

    interface HeaderMap {
      [key: string]: string;
    }

    interface Thenable<T> {
      then<U>(onResolved?: (value: T) => U | Thenable<U>, onRejected?: (error: any) => U | Thenable<U>): Thenable<U>;
      catch<U>(onRejected: (error: any) => U | Thenable<U>): Thenable<U>;
    }

    interface Cookie {
      toString(): string;
    }

    interface SetCookieOptions {
      http?: boolean;
      secure?: boolean;
      now?: Date;
      ignoreError?: boolean;
    }

    interface GetCookieOptions {
      http?: boolean;
      secure?: boolean;
      now?: Date;
      expire?: boolean;
      allPaths?: boolean;
    }

    interface CookieJar {
      rejectPublicSuffixes: boolean;
      setCookie(cookieOrString: string | Cookie, currentUrl: string, cb: (err: Error, cookie?: Cookie) => any): void;
      setCookie(cookieOrString: string | Cookie, currentUrl: string, options: SetCookieOptions, cb: (err: Error, cookie?: Cookie) => any): void;
      getCookies(currentUrl: string, cb: (err: Error, cookies?: Cookie[]) => any): void;
      getCookies(currentUrl: string, options: GetCookieOptions, cb: (err: Error, cookies?: Cookie[]) => any): void;
    }

    class Headers {
      headers: HeaderMap;
      headerNames: HeaderMap;

      set(name: string, value: string): Headers;
      set(headers: HeaderMap): Headers;
      append(name: string, value: string): Headers;
      name(name: string): string;
      get(): HeaderMap;
      get(name: string): string;
      remove(name: string): Headers;
      type(): string;
      type(type: string): Request;
    }

    interface RequestJSON {
      url: string;
      method: string;
      headers: HeaderMap;
    }

    class Request extends Headers implements Thenable<Response> {
      url: string;
      method: string;
      body: any;
      query: QueryMap;
      timeout: number;
      jar: CookieJar;
      maxRedirects: number;
      rejectUnauthorized: boolean;
      agent: any;
      stream: boolean;
      raw: boolean;
      encoding: string;
      withCredentials: boolean;
      parse: boolean;
      opened: boolean;
      aborted: boolean;
      uploaded: number;
      downloaded: number;
      completed: number;
      uploadedSize: number;
      uploadedTotal: number;
      downloadedSize: number;
      downloadedTotal: number;
      response: Response;

      constructor(options: Options);
      fullUrl(): string;
      error(message: string): Error;
      progress(fn: (request: Request) => any): Request;
      abort(): Request;
      use(fn: (request: Request) => any): Request;
      before(fn: (request: Request) => any): Request;
      after(fn: (request: Request) => any): Request;
      always(fn: (request: Request) => any): Request;
      then<U>(fn: (response: Response) => U | Thenable<U>): Thenable<U>;
      catch<U>(fn: (error: Error) => U | Thenable<U>): Thenable<U>;
      exec(fn: (err: Error, response: Response) => any): void;
      toJSON(): RequestJSON
    }

    interface ResponseJSON {
      headers: HeaderMap;
      body: any;
      status: number;
    }

    class Response extends Headers {
      request: Request;
      body: any;
      status: number;

      statusType(): number;
      error(message: string): Error;
      toJSON(): ResponseJSON;
    }

    function jar (): CookieJar;

    function form (): FormData;
  }

  export = popsicle;
}
