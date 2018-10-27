const TAG = 'IOManager';

const _ = require('underscore');

const configuredDriversId = [];
const enabledDrivers = {};
const enabledAccesories = {};
const enabledListeners = {};
const queueProcessing = {};
const emitter = exports.emitter = new(require('events').EventEmitter)();

/**
 * Define constants used when forwarding output to an accessory
 */
exports.CAN_HANDLE_OUTPUT = {
	YES_AND_BREAK: true,
	YES_AND_CONTINUE: true,
	NO: false
};

/**
 * Global session object
 */
exports.session = null;

/**
 * Send an event with data to all IO drivers
 * @param {String} name	Name of the event
 * @param {Object} data Payload for the event
 */
exports.eventToAllIO = function (name, data) {
	for (let k of Object.keys(enabledDrivers)) {
		enabledDrivers[k].emitter.emit(name, data);
	}
};

/**
 * Process an input to a specific IO driver based on the session
 * @param {Object} e
 * @param {Object} e.session Session object
 * @param {Object} e.params Input params object
 * @param {Object} e.body A Dialogflow body payload 
 * @param {Object} e.fulfillment A Dialogflow direct fulfillment
 * @param {String} e.params.text A text query to parse over Dialogflow
 * @param {Object} e.params.event An event query to parse over Dialogflow 
 */
exports.handle = async function ({
	session,
	params = {},
	fulfillment = null,
	body = null
}) {
	session = session || IOManager.session;
	let driverStr = session.io_driver;

	console.info(TAG, 'handle', {
		session,
		params,
		fulfillment,
		body
	});

	// If this driver is not up & running for this configuration,
	// the item could be handled by another platform that has that driver configured,
	// so we'll enqueue it.
	if (false === isIdDriverUp(session.io_id)) {
		console.info(TAG, 'putting in IO queue', {
			session,
			params,
			fulfillment
		});

		new Data.IOQueue({
			io_id: session.io_id,
			session: session._id,
			fulfillment: fulfillment,
			params: params
		}).save();

		return {
			inQueue: true
		};
	}

	// Redirect to another driver if is configured to do that
	// by simplying replacing the driver
	if (config.ioRedirectMap[driverStr] != null) {
		driverStr = config.ioRedirectMap[driverStr];
		console.info(TAG, `<${session.io_driver}> redirect output to <${driverStr}>`);
	}

	// Get the driver object 
	const driver = enabledDrivers[driverStr];

	// Only one of those can be fulfilled, in this order
	if (fulfillment) {
		// Direct fulfillment
		fulfillment = await AI.fulfillmentTransformer(fulfillment, session);
	} else if (body) {
		// Body resolution with action calling
		fulfillment = await AI.fulfillmentFromBody(body, session);
	} else if (params) {
		if (params.text) {
			// Interrogate AI to get fulfillment by textRequest
			fulfillment = await AI.textRequest(params.text, session);
		} else if (params.event) {
			// Interrogate AI to get fulfillment by eventRequest
			fulfillment = await AI.eventRequest(params.event, session);
		} else {
			console.warn('Neither text, event in params is not null');
		}
	}

	if (fulfillment == null) {
		console.warn('Do not output to driver because fulfillment is null - this could be intentional');
		return;
	}

	// Call the output
	driver.output(fulfillment, session);

	// Process output accessories:
	// An accessory can:
	// - handle a kind of output, process it and blocking the next accessory
	// - handle a kind of output, process it but don't block the next accessory
	// - do not handle and forward to next accessory
	(async () => {
		for (let accessory of (enabledAccesories[driverStr] || [])) {
			let handleType = accessory.canHandleOutput(fulfillment, session);

			switch (handleType) {
				case IOManager.CAN_HANDLE_OUTPUT.YES_AND_BREAK:
					console.info(TAG, `forwarding output to <${accessory.id}> with YES_AND_BREAK`);
					await accessory.output(fulfillment, session);
					return;
				case IOManager.CAN_HANDLE_OUTPUT.YES_AND_CONTINUE:
					console.info(TAG, `forwarding output to <${accessory.id}> with YES_AND_CONTINUE`);
					await accessory.output(fulfillment, session);
					break;
				case IOManager.CAN_HANDLE_OUTPUT.NO:
				default:
					break;
			}
		}
	})();
};

/**
 * Process a fulfillment to a session 
 * @param {Object} fulfillment Fulfillment payload
 * @param {Object} session Session object
 */
exports.output = function (fulfillment, session) {
	console.info(TAG, 'direct output', {
		fulfillment,
		session
	});
	return exports.handle({
		session: session,
		fulfillment: fulfillment
	});
};

/**
 * Configure every accessory for that driver
 * @param {String} driverStr 
 */
function configureAccessories(driverStr) {
	const driver = enabledDrivers[driverStr];

	for (let accessory of (enabledAccesories[driverStr] || [])) {
		console.info(TAG, `attaching accessory <${accessory.id}> to <${driverStr}>`);
		accessory.attach(driver);
	}
}

/**
 * Configure driver by handling its input event, 
 * parsing it and re-calling the output method of the driver
 * @param {String} driverStr 
 */
function configureDriver(driverStr) {
	console.info(TAG, `configuring IO Driver <${driverStr}>`);

	const driver = enabledDrivers[driverStr];

	// Link Driver.Input to IOManager.Handle --> Driver.Output
	driver.emitter.on('input', async (e) => {
		console.info(TAG, `received input from driver <${driverStr}>`);

		try {
			// If input has the error key, throw again to handle in the catch
			if (e.error) throw e.error;
			await exports.handle(e);
		} catch (ex) {
			console.error(TAG, 'driver input error', ex);
			e.fulfillment = {
				data: {
					error: ex
				}
			};
			await exports.handle(e);
		}
	});

	configureAccessories(driverStr);
	driver.startInput();
}

/**
 * Return true if this driver is currently enabled
 * @param {String} driverId 
 */
function isIdDriverUp(driverId) {
	return configuredDriversId.indexOf(driverId) >= 0;
}

/**
 * Return an array of drivers strings to load
 */
function getDriversToLoad() {
	if (process.env.OTTO_IO_DRIVERS) return process.env.OTTO_IO_DRIVERS.split(',');
	return config.ioDrivers || [];
}

/**
 * Return an array of accessories strings to load for that driver
 * @param {String} driver 
 */
function getAccessoriesToLoad(driver) {
	if (process.env.OTTO_IO_ACCESSORIES) return process.env.OTTO_IO_ACCESSORIES.split(',');
	return config.ioAccessoriesMap[driver] || [];
}

/**
 * Return an array of listeners strings to load
 */
function getListenersToLoad() {
	if (process.env.OTTO_IO_LISTENERS) return process.env.OTTO_IO_LISTENERS.split(',');
	return config.listeners || [];
}

/**
 * Effectively load configured drivers
 */
function loadDrivers() {
	const driversToLoad = getDriversToLoad();
	console.info(TAG, 'drivers to load', driversToLoad);
	for (let driverStr of driversToLoad) {
		let driver = exports.getDriver(driverStr);

		if (config.serverMode == true && driver.config.onlyClientMode == true) {
			console.error(TAG, 'unable to load <' + driverStr + '> because this IO is not compatible with server mode');
			continue;
		}

		if (config.serverMode == false && driver.config.onlyServerMode == true) {
			console.error(TAG, 'unable to load <' + driverStr + '> because this IO is not compatible with client mode');
			continue;
		}

		enabledDrivers[driverStr] = driver;

		const driverId = config.uid + '/' + driver.config.id;
		configuredDriversId.push(driverId);
		console.info(TAG, 'enabled driver', driverId);

		driver.emitter.emit('loaded');
	}
}

/**
 * Effectively load configured accessories for each enabled driver
 */
function loadAccessories() {
	const driversToLoad = getDriversToLoad();
	for (let driverStr of driversToLoad) {
		enabledAccesories[driverStr] = [];
		const accessoriesToLoad = getAccessoriesToLoad(driverStr);
		console.info(TAG, 'accesories to load', driverStr, accessoriesToLoad);
		for (let accessory of accessoriesToLoad) {
			enabledAccesories[driverStr].push(exports.getAccessory(accessory));
		}
	}
}

/**
 * Effectively load configured listeners
 */
function loadListeners() {
	const listenersToLoad = getListenersToLoad();
	console.info(TAG, 'listeners to load', listenersToLoad);

	for (let listenerStr of listenersToLoad) {
		const listener = exports.getListener(listenerStr);
		enabledListeners[listenerStr] = listener;
		listener.listen();
	}
}

/**
 * Encode an object to be sure that can be passed to API requests
 * @param {Object} b 
 */
exports.encodeBody = function (b) {
	return {
		body: new Buffer(JSON.stringify(b)).toString('base64')
	};
};

/**
 * Decode an object previously encoded via IOManager.encodeBody
 * @param {Object} fulfillment 
 */
exports.decodeBody = function (fulfillment) {
	return JSON.parse(new Buffer(fulfillment.payload.body, 'base64').toString('ascii'));
};

/**
 * Load the driver module
 * @param {String} e 
 */
exports.getDriver = function (e) {
	return require(__basedir + '/src/io/' + e);
};

/**
 * Load the listener module
 * @param {String} e 
 */
exports.getListener = function (e) {
	return require(__basedir + '/src/listeners/' + e);
};

/**
 * Load the accessory module
 * @param {String} e 
 */
exports.getAccessory = function (e) {
	return require(__basedir + '/src/io_accessories/' + e);
};

/**
 * Write a log of what (global) user said - uses: IOManager.session as a user
 * @param {String} text 
 */
exports.writeLog = async function (text) {
	return exports.writeLogForSession(text, exports.session);
};

/**
 * Write a log of what user said 
 * @param {Object} session 
 * @param {String} text 
 */
exports.writeLogForSession = async function (text, session = {}) {
	return (new Data.SessionInput({
		session: session._id,
		text: text
	})).save();
};

/**
 * Load the session from ORM
 * @param {String} sessionIdComposite 
 */
exports.getSession = function (sessionIdComposite) {
	return Data.Session.findOne({
		_id: sessionIdComposite
	});
};

/**
 * Register a new session onto ORM
 * @param {Object} e
 * @param {String} e.io_driver IO Driver string
 * @param {Object} e.io_data IO Additional data
 * @param {String} [e.sessionId=null] Session unique ID. If null, act as a global session
 * @param {String} [e.alias=null] Alias of this session
 * @param {String} [e.text=null] Eventual initial text that user said
 */
exports.registerSession = async function ({
	sessionId,
	io_driver,
	io_data,
	alias,
	text
}) {
	const io_id = config.uid + '/' + io_driver;
	const sessionIdComposite = io_id + (sessionId == null ? '' : '/' + sessionId);

	let session = await exports.getSession(sessionIdComposite);

	if (session == null) {
		console.info(TAG, 'a new session model registered: ' + sessionId);
		session = await (new Data.Session({
			_id: sessionIdComposite,
			io_id: io_id,
			io_driver: io_driver,
			io_data: io_data,
			alias: alias,
			settings: {
				updated_at: Date.now()
			},
			pipe: {
				updated_at: Date.now()
			},
			server_settings: config.uid
		}).save());
	}

	if (text != null) exports.writeLogForSession(text, session);
	if (sessionId == null) exports.updateGlobalSession(session);
	return session;
};

/**
 * Register this session as global session, available via IOManager.session
 * @param {Object} session 
 */
exports.updateGlobalSession = function (session) {
	if (exports.session != null) return;

	console.info(TAG, 'updating global session model');
	exports.session = session;
	emitter.emit('session_ready');
};

/**
 * Process items in the queue based on configured drivers 
 */
async function processQueue() {
	let qitem = await Data.IOQueue.findOne({
		io_id: {
			$in: configuredDriversId
		}
	});

	if (qitem == null) return null;

	// Lock current item to avoid double processing
	if (queueProcessing[qitem._id]) return;
	queueProcessing[qitem._id] = true;

	console.info(TAG, 'processing queue item');
	console.dir(qitem, {
		depth: 2
	});

	// Remove from database
	qitem.remove();

	// Handle this item
	exports.handle(qitem);

	return qitem;
}

/**
 * Start the polling to process IO queue
 */
exports.startQueuePolling = async function () {
	processQueue();
	await timeout(1000);
	exports.startQueuePolling();
};

/**
 * Start drivers, accessories and listeners
 */
exports.start = function () {
	loadDrivers();
	loadAccessories();
	for (let driverStr of Object.keys(enabledDrivers)) {
		configureDriver(driverStr);
	}
	loadListeners();
};