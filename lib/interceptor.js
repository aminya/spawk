'use strict'

const cp = require('child_process')
const util = require('util')
const stream = require('stream')

const _interceptor = Symbol('interceptor')

function compareOptions (defined, called) {
  const serializable = ['cwd', 'argv0', 'detached', 'uid', 'gid', 'serialization',
    'shell', 'windowsVerbatimArguments', 'windowsHide', 'stdio']

  for (const attr of serializable) {
    if (Object.prototype.hasOwnProperty.call(defined, attr) && JSON.stringify(defined[attr]) !== JSON.stringify(called[attr])) {
      return false
    }
  }
  if (Object.prototype.hasOwnProperty.call(defined, 'env')) {
    if (!Object.prototype.hasOwnProperty.call(called, 'env')) {
      return false
    }
    const envKeys = Object.keys(defined.env)
    for (const envKey of envKeys) {
      if (defined.env[envKey] !== called.env[envKey]) {
        return false
      }
    }
  }
  return true
}

// Abstraction to isolate interceptor from the public interface.
// Spawk returns this object to the user, but interacts with the
// Interceptor itself
class API {
  constructor (interceptor) {
    this[_interceptor] = interceptor
  }

  get command () {
    return this[_interceptor].command
  }

  get args () {
    return this[_interceptor].args
  }

  get options () {
    return this[_interceptor].options
  }

  get called () {
    return this[_interceptor].called
  }

  get calledWith () {
    if (this.called) {
      return this[_interceptor].calledWith
    }
  }

  get description () {
    let description = `called spawk interceptor for command: '${this.command}'`
    if (!this.called) {
      description = `un${description}`
    }
    if (this.args) {
      description = `${description}, args: ${util.inspect(this.args)}`
    }
    if (this.options) {
      description = `${description}, options: ${util.inspect(this.options)}`
    }
    return description
  }

  toString () {
    return this.description
  }

  exit (code) {
    this[_interceptor].exitCode = code
    return this
  }

  signal (signal) {
    this[_interceptor].signal = signal
    return this
  }

  stdout (stdout) {
    this[_interceptor].stdout = stdout
    return this
  }

  stderr (stderr) {
    this[_interceptor].stderr = stderr
    return this
  }
}

class Interceptor {
  constructor (command, args, options) {
    this.mocks = {
      exitCode: 0,
      signal: null,
      child: new cp.ChildProcess()
    }
    this.command = command
    this.args = args
    this.options = options
    this.called = false
    this.api = new API(this)
  }

  get exitCode () {
    const { exitCode } = this.mocks
    if (typeof exitCode === 'function') {
      return exitCode.call(this.api)
    }
    return exitCode
  }

  set exitCode (code) {
    this.mocks.exitCode = code
  }

  get signal () {
    const { signal } = this.mocks
    if (typeof signal === 'function') {
      return signal.call(this.api)
    }
    return signal
  }

  set signal (signal) {
    this.mocks.signal = signal
  }

  get stdout () {
    const { stdout } = this.mocks
    if (typeof stdout === 'function') {
      return stdout.call(this.api)
    }
    return stdout
  }

  set stdout (stdout) {
    this.mocks.stdout = stdout
  }

  get stderr () {
    const { stderr } = this.mocks
    if (typeof stderr === 'function') {
      return stderr.call(this.api)
    }
    return stderr
  }

  set stderr (stderr) {
    this.mocks.stderr = stderr
  }

  match (command, args = [], options = {}) {
    if (this.called) { // For now we can only be called once
      return false
    }

    if (typeof this.command === 'function') {
      if (!this.command.call(this.api, command, args, options)) {
        return false
      }
    } else if (this.command instanceof RegExp) {
      if (!this.command.test(command)) {
        return false
      }
    } else if (command !== this.command) {
      return false
    }

    if (typeof this.args === 'function') {
      if (!this.args.call(this.api, args)) {
        return false
      }
    } else if (this.args && (this.args.toString() !== args.toString())) {
      return false
    }

    if (typeof this.options === 'function') {
      if (!this.options.call(this.api, options)) {
        return false
      }
    } else if (this.options && !compareOptions(this.options, options)) {
      return false
    }

    return true
  }

  run (command, args, options) {
    this.called = true
    this.calledWith = { command, args, options }

    this.child = new cp.ChildProcess()
    this.child.stdin = new stream.PassThrough({ autoDestroy: true })
    this.child.stdout = new stream.PassThrough({ autoDestroy: true })
    this.child.stderr = new stream.PassThrough({ autoDestroy: true })
    this.child.stdio = [this.child.stdin, this.child.stdout, this.child.stderr]
    this.child.spawnargs = args
    this.child.emit('spawn')
    process.nextTick(async () => {
      const [exitCode, signal, stdout, stderr] = await Promise.all(
        [this.exitCode, this.signal, this.stdout, this.stderr]
      )
      this.child.exitCode = exitCode
      this.child.signalCode = signal
      this.child.connected = false
      if (stdout) {
        this.child.stdout.write(stdout)
      }
      this.child.stdout.end()
      if (stderr) {
        this.child.stderr.write(stderr)
      }
      this.child.stderr.end()
      this.child.emit('exit', exitCode, signal)
      this.child.emit('close', exitCode, signal)
    })
    return this.child
  }

  toString () {
    return this.api.description
  }
}

module.exports = Interceptor
