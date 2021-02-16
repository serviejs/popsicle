"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.headers = void 0;
var FormData = require("form-data");
var common_1 = require("./common");
__exportStar(require("./common"), exports);
function headers() {
    var common = common_1.headers();
    return function (request, next) {
        return common(request, function () {
            if (!request.get('User-Agent')) {
                request.set('User-Agent', 'Popsicle (https://github.com/blakeembrey/popsicle)');
            }
            if (request.body instanceof FormData) {
                request.set('Content-Type', 'multipart/form-data; boundary=' + request.body.getBoundary());
                return new Promise(function (resolve) {
                    request.body.getLength(function (err, length) {
                        if (err) {
                            request.set('Transfer-Encoding', 'chunked');
                        }
                        else {
                            request.set('Content-Length', String(length));
                        }
                        return resolve(next());
                    });
                });
            }
            var length = 0;
            var body = request.body;
            if (body && !request.get('Content-Length')) {
                if (Array.isArray(body)) {
                    for (var i = 0; i < body.length; i++) {
                        length += body[i].length;
                    }
                }
                else if (typeof body === 'string') {
                    length = Buffer.byteLength(body);
                }
                else {
                    length = body.length;
                }
                if (length) {
                    request.set('Content-Length', String(length));
                }
                else if (typeof body.pipe === 'function') {
                    request.set('Transfer-Encoding', 'chunked');
                }
                else {
                    return Promise.reject(request.error('Argument error, `options.body`', 'EBODY'));
                }
            }
            return next();
        });
    };
}
exports.headers = headers;
//# sourceMappingURL=index.js.map