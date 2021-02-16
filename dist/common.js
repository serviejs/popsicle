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
exports.createTransport = exports.jar = exports.form = exports.plugins = exports.FormData = exports.PopsicleError = exports.head = exports.del = exports.patch = exports.put = exports.post = exports.get = exports.request = exports.defaults = void 0;
var FormData = require("form-data");
exports.FormData = FormData;
var request_1 = require("./request");
var plugins = require("./plugins/index");
exports.plugins = plugins;
var form_1 = require("./form");
exports.form = form_1.default;
var jar_1 = require("./jar");
exports.jar = jar_1.default;
var error_1 = require("./error");
exports.PopsicleError = error_1.default;
var index_1 = require("./index");
Object.defineProperty(exports, "createTransport", { enumerable: true, get: function () { return index_1.createTransport; } });
function defaults(defaultsOptions) {
    var transport = index_1.createTransport({ type: 'text' });
    var defaults = Object.assign({}, { transport: transport }, defaultsOptions);
    return function popsicle(options) {
        var opts = Object.assign({}, defaults, typeof options === 'string' ? { url: options } : options);
        if (typeof opts.url !== 'string') {
            throw new TypeError('The URL must be a string');
        }
        return new request_1.Request(opts);
    };
}
exports.defaults = defaults;
exports.request = defaults({});
exports.get = defaults({ method: 'get' });
exports.post = defaults({ method: 'post' });
exports.put = defaults({ method: 'put' });
exports.patch = defaults({ method: 'patch' });
exports.del = defaults({ method: 'delete' });
exports.head = defaults({ method: 'head' });
__exportStar(require("./base"), exports);
__exportStar(require("./request"), exports);
__exportStar(require("./response"), exports);
exports.default = exports.request;
//# sourceMappingURL=common.js.map