const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const originalExec = childProcess.exec;

childProcess.exec = function execWithNetUseShim(command, options, callback) {
  let cb = callback;
  let opts = options;
  if (typeof options === "function") {
    cb = options;
    opts = undefined;
  }

  if (typeof command === "string" && /^\s*net\s+use\s*$/i.test(command)) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    process.nextTick(() => {
      child.stdout.end("");
      child.stderr.end("");
      if (typeof cb === "function") cb(null, "", "");
      child.emit("exit", 0, null);
      child.emit("close", 0, null);
    });
    return child;
  }

  return originalExec.call(this, command, opts, cb);
};
