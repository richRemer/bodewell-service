const fs = require("fs");
const Resource = require("bodewell-resource");
const Monitor = require("bodewell-monitor");

const resources$priv = Symbol("Service.resources");
const monitors$priv = Symbol("Service.monitors");
const discovery$priv = Symbol("Service.discovery");

const console$priv = Symbol("Service.console");
const logfile$priv = Symbol("Service.logfile");
const openlog$priv = Symbol("Service.openlog");
const noise$priv = Symbol("Service.noise");
const debug$priv = Symbol("Service.debug");
const loop$priv = Symbol("Service.loop");

/**
 * Bodewell service object.
 * @constructor
 * @param {object} opts
 */
function Service(opts) {
    Resource.call(this, function() {
        return this.resources().every(Number);  // all non-zero
    });

    this[resources$priv] = new Map();
    this[monitors$priv] = new Map();
}

Service.prototype = Object.create(Resource.prototype);

Service.prototype[resources$priv] = null;
Service.prototype[monitors$priv] = null;
Service.prototype[discovery$priv] = null;

Service.prototype[console$priv] = null;
Service.prototype[logfile$priv] = null;
Service.prototype[openlog$priv] = null;
Service.prototype[noise$priv] = 0;
Service.prototype[debug$priv] = false;

Service.prototype[loop$priv] = null;

/**
 * Start monitoring.
 */
Service.prototype.start = function() {
    if (!this[loop$priv]) {
        this[loop$priv] = this.loop();
        Array.from(this[monitors$priv].values()).forEach(res => res.start());
        this.info("service started");
    }
};

/**
 * Stop monitoring.
 */
Service.prototype.stop = function() {
    if (this[loop$priv]) {
        this[loop$priv]();
        this[loop$priv] = null;
        this.info("service stopped");
    }
};

/**
 * Define a resource.
 * @param {string} name
 * @param {function} Resource
 */
Service.prototype.resource = function(name, Resource) {
    if (arguments.length < 2) {
        return Resource.prototype.resource.call(this, name);
    }

    if (this[resources$priv].has(name)) {
        throw new Error(`cannot redefine '${name}' resource`);
    }

    this[resources$priv].set(name, Resource);
};

/**
 * Define or configure a monitor.
 * @param {string} name
 * @param {object} opts
 * @param {string} opts.resource
 */
Service.prototype.monitor = function(name, opts) {
    var action = this[monitors$priv].has(name) ? "configuring" : "defining";
    this.info(`${action} ${name} monitor`);

    if (this[monitors$priv].has(name)) {
        this[monitors$priv].get(name).configure(opts);
    } else {
        this[monitors$priv].set(name, new Monitor(this, opts.resource));
        this[monitors$priv].get(name).configure(opts);
    }
};

/**
 * Execute automatic resource discovery.
 * @returns {Promise}
 */
Service.prototype.discover = function() {
    var discovered;

    this.info("discovering resources");

    discovered = Array.from(this[resources$priv].values())
        .filter(Resource => typeof Resource.discover === "function")
        .map(Resource => Resource.discover(this));

    return Promise.all(discovered)
        .then(d => d.reduce((a,b) => a.concat(b), []))
        .then(d => {
            this.info(`discovered ${d.length} resources`);
        });
}

/**
 * Create service loop.  Returns loop cancel function.  This is called by the
 * .start() method; these methods are not intended to be used together.
 * @returns {function}
 */
Service.prototype.loop = function() {
    var service = this,
        loop,
        delay = 10 * 60 * 1000; // 10 mins

    function iteration() {
        service.discover()
            .catch(err => service.error(err))
            .then(() => loop = setTimeout(iteration, delay));
    }

    loop = setTimeout(iteration, 0);

    return function() {
        if (loop) clearTimeout(loop);
        loop = null;
    };
}

/**
 * Write information message to log.
 * @param {string} message
 */
Service.prototype.info = function(message) {
    this.log("INFO", message);

    if (this.console && this[noise$priv] >= 2) {
        console.log(message);
    }
};

/**
 * Write warning message to log.
 * @param {string} message
 */
Service.prototype.warn = function(message) {
    this.log("WARN", message);

    if (this.console && this[noise$priv] >= 1) {
        console.error("WARNING:", message);
    }
};

/**
 * Write error or error message to log.
 * @param {Error|string} err
 */
Service.prototype.error = function(err) {
    var errmsg = err[this.debugging ? "stack" : "message"] || err;

    this.log("ERRO", errmsg);

    if (this.console && this[noise$priv] >= 0) {
        console.error("ERROR:", errmsg);
    }
};

/**
 * Increase amount of information written to console.
 */
Service.prototype.louder = function() {
    this[noise$priv]++;
};

/**
 * Decrease amount of information written to console.
 */
Service.prototype.quieter = function() {
    this[noise$priv]--;
};

/**
 * Enable debugging; outputs stack traces when error occurs.
 */
Service.prototype.enableDebugging = function() {
    this[debug$priv] = true;
};

/**
 * Disable debugging.
 */
Service.prototype.disableDebugging = function() {
    this[debug$priv] = false;
};

/**
 * Attach service to console.
 * @param {Console} console
 */
Service.prototype.attachConsole = function(console) {
    this[console$priv] = console;
};

/**
 * Detach service from console.
 */
Service.prototype.detachConsole = function() {
    this[console$priv] = null;
};

/**
 * Attach service to log file.
 * @param {string} log
 */
Service.prototype.attachLog = function(log) {
    this.closeLog();
    this[logfile$priv] = log;
};

/**
 * Open log.
 * @param {stream.Writable} [log]
 */
Service.prototype.openLog = function(log) {
    this.closeLog();

    if (!log && this[logfile$priv]) {
        log = fs.createWriteStream(this[logfile$priv], {flags: "a"});
    } else if (!log) {
        throw new Error("exected writable stream");
    }

    this[openlog$priv] = log;
};

/**
 * Close log.  If service is attached to a log file, the log will automatically
 * re-open when needed.
 */
Service.prototype.closeLog = function() {
    if (this[openlog$priv]) {
        this[openlog$priv].end();
        this[openlog$priv] = null;
    }
};

/**
 * Detach service from log.  Return false when there is no attached log.
 * @returns {boolean}
 */
Service.prototype.detachLog = function() {
    this.closeLog();
    this[logfile$priv] = null;
};

/**
 * Write message to log.
 * @param {Date] [when]
 * @param {string} type
 * @param {string} message
 */
Service.prototype.log = function(when, type, message) {
    var args = Array.prototype.slice.call(arguments),
        msg;

    when = args[0] instanceof Date ? args.shift() : null;
    type = args.length > 1 ? args.shift() : "INFO";
    message = args.shift();

    if (!(when instanceof Date)) when = new Date();
    when = when.toISOString();

    msg = `${when} [${type}] ${message}\n`;

    if (!this[openlog$priv] && this.logfile) this.openLog();
    if (this[openlog$priv]) this[openlog$priv].write(msg);
};

Object.defineProperties(Service.prototype, {
    /**
     * Attached console.
     * @name Service#console
     * @type {Console}
     * @readonly
     */
    console: {
        configurable: true,
        enumerable: true,
        get: function() {return this[console$priv];}
    },

    /**
     * Attached log file.
     * @name Service#logfile
     * @type {string}
     * @readonly
     */
    logfile: {
        configurable: true,
        enumerable: true,
        get: function() {return this[logfile$priv];}
    },

    /**
     * True when debugging is enabled.
     * @name Service#debugging
     * @type {boolean}
     * @readonly
     */
    debugging: {
        configurable: true,
        enumerable: true,
        get: function() {return this[debug$priv];}
    }
});

module.exports = Service;
