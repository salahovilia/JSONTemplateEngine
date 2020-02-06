const { rangeFunctionHelper } = require("./helpers");
const { eachHelper } = require("./helpers");
const { ifHelper } = require("./helpers");
const { commentHelper } = require("./helpers");

module.exports = class JSONTemplateEngine {
  constructor() {
    this._helpers = {};
    this._helpersFunctions = {};
    this._handlerProxyData = {
      get: (target, name) => {
        if (typeof target[name] === "function") {
          return target[name]();
        } else {
          return target[name];
        }
      }
    };

    this.registerHelper("#comment", commentHelper);
    this.registerHelper("#if", ifHelper);
    this.registerHelper("#each", eachHelper);

    this.registerFunctionHelper("#range", rangeFunctionHelper);
  }
  registerHelper(directive, handler) {
    if (directive in this._helpers) {
      throw new Error(`${directive} already exist.`);
    }
    this._helpers[directive] = handler;
  }
  registerFunctionHelper(directive, handler) {
    if (directive in this._helpersFunctions) {
      throw new Error(`${directive} already exist.`);
    }
    this._helpersFunctions[directive] = handler;
  }
  async parseTemplate(template, data) {
    const type = this.getTypeArrayOrObject(template);
    let result = type === "array" ? [] : {};

    for (const key of Object.keys(template)) {
      if (this._helpers[key] !== undefined) {
        const reservedKeysResult = await this._helpers[key](
          template[key],
          data,
          {
            parseTemplate: this.parseTemplate.bind(this),
            parseValue: this.parseValue.bind(this)
          }
        );
        if (reservedKeysResult !== undefined) {
          result = reservedKeysResult;
        } else {
          delete result[key];
        }
        continue;
      }
      if (typeof template[key] === "number") {
        result[key] = template[key];
        continue;
      }
      if (typeof template[key] === "string") {
        const resultParseValue = await this.parseValue(template[key], data);
        if (resultParseValue !== undefined) {
          result[key] = resultParseValue;
        }
        continue;
      }
      if (typeof template[key] === "object") {
        const resultCompile = await this.parseTemplate(template[key], data);
        if (resultCompile) {
          if (type === "object") {
            result[key] = resultCompile;
          } else {
            result.push(resultCompile);
          }
        }
        continue;
      }
    }
    if (Object.keys(result).length) {
      return result;
    } else {
      return undefined;
    }
  }
  async parseValue(value, data) {
    const reg = new RegExp("{{(.*?)}}", "g");
    const resultParseValue = value.replace(reg, (...match) => {
      const resultEval = this.evaluateExpression(match[1].trim(), data);
      return this.stringifyValue(resultEval);
    });
    const regFunction = /((#.+?)\((.*?)\)).*?/g;
    const resultParseFunction = await this.replaceAsync(
      resultParseValue,
      regFunction,
      async (...match) => {
        return this.stringifyValue(
          await this._helpersFunctions[match[2]](
            ...match[3].split(",").map(value => this.convertValue(value))
          )
        );
      }
    );
    return this.convertValue(resultParseFunction);
  }
  evaluateExpression(expression, data) {
    const evaluate = new Function(
      "data",
      `
      with (data) {
        return ${expression};
      }`
    );

    try {
      return evaluate(data);
    } catch (e) {
      console.error(e.message);
    }
  }
  convertValue(value) {
    if (value.length === 0) {
      return undefined;
    }
    if (!isNaN(Number(value))) {
      return Number(value);
    }
    if (value.trim().toLowerCase() === "true") {
      return true;
    }
    if (value.trim().toLowerCase() === "false") {
      return false;
    }
    return this.tryParseJSON(value);
  }
  stringifyValue(value) {
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return value;
  }
  tryParseJSON(jsonString) {
    try {
      const o = JSON.parse(jsonString);
      if (o && typeof o === "object") {
        return o;
      }
    } catch (e) {}

    return jsonString;
  }
  getTypeArrayOrObject(obj) {
    if (obj instanceof Array) {
      return "array";
    } else if (obj instanceof Object) {
      return "object";
    }
  }
  async replaceAsync(str, regex, asyncFn) {
    const promises = [];
    str.replace(regex, (match, ...args) => {
      const promise = asyncFn(match, ...args);
      promises.push(promise);
    });
    const data = await Promise.all(promises);
    return str.replace(regex, () => data.shift());
  }
  async compile(template, data = {}) {
    const proxyData = new Proxy(data, this._handlerProxyData);
    return this.parseTemplate(template, proxyData);
  }
};
