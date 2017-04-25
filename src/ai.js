const TAG = 'AI';
const _config = config.apiai;

const client = require('apiai')(_config.token);

const AI_NAME_REGEX = /Otto\b\W+/i;
const Actions = require(__basedir + '/src/actions');
const Translator = apprequire('translator');

exports.fulfillmentTransformer = function(f, session_model) {
	return new Promise((resolve, reject) => {
		f.data = f.data || {}; // Ensure always data object exists
		
		if (f.data.pending) {
			console.debug(TAG, 'Saving pending action', session_model.id, f.data.pending);
			new ORM.IOPending({
				session_id: session_model.id,
				action: f.data.pending.action,
				data: f.data.pending.data
			}).save();
		}

		if (session_model.get('translate_to')) {
			const language = session_model.get('translate_to');
			console.info(TAG, 'Translating output', { language });

			if (!_.isEmpty(f.speech)) {
				Translator.translate(f.speech, language, (err, new_speech) => {
					if (err) return resolve(f);
					f.speech = new_speech;	
					resolve(f);
				});
				
			} else if (f.data.error && !_.isEmpty(f.data.error.speech)) {
				Translator.translate(f.data.error.speech, language, (err, new_speech) => {
					if (err) return resolve(f);
					f.data.error.speech = new_speech;	
					resolve(f);
				});

			} else {
				resolve(f);
			}

		} else {
			resolve(f);
		}
	});
};

exports.fulfillmentPromiseTransformer = function(fn, data, session_model) {
	return new Promise((resolve, reject) => {

		// Start a timeout to ensure that the promise
		// will be anyway triggered, also with an error
		let timeout = setTimeout(() => {
			exports.fulfillmentTransformer({
				data: {
					error: {
						timeout: true
					}
				}
			}, session_model)
			.then(resolve);
		}, 1000 * (_config.promiseTimeout || 10));

		fn(data, session_model)
		.then((fulfillment) => {

			clearTimeout(timeout);

			exports.fulfillmentTransformer(fulfillment, session_model)
			.then(resolve);

		})
		.catch((err) => {

			exports.fulfillmentTransformer({
				data: {
					error: err
				}
			}, session_model)
			.then(resolve);

		});
	});
};

exports.textRequestTransformer = function(text, session_model) {
	return new Promise((resolve, reject) => {

		text = text.replace(AI_NAME_REGEX, ''); // Remove the AI name in the text

		if (session_model.get('translate_from')) {
			console.info(TAG, 'Translating input');
			Translator.translate(text, 'it', (err, new_text) => {
				if (err) return resolve(text, session_model);
				resolve(new_text);
			});
		} else {
			resolve(text);
		}

	});
};

exports.textRequest = function(text, session_model) {
	return new Promise((resolve, reject) => {

		new ORM.IOPending()
		.where({ session_id: session_model.id })
		.fetch({ require: true })
		.then((pending) => {

			console.debug(TAG, 'Resolving pending action', pending);

			const action_fn = Actions.list[ pending.get('action') ];
			AI.fulfillmentPromiseTransformer(fn(), {
				sessionId: session_model.id,
				result: { 
					resolvedQuery: text,
					action: pending.get('action'),
					parameters: pending.getData(),
					actionIncomplete: false,
					contexts: [],
					score: 1 
				},
			}, session_model)
			.then((e) => {
				pending.destroy();
				resolve(e);
			})
			.catch(reject);

		})
		.catch(() => {

			exports.textRequestTransformer(text, session_model)
			.then((text) => {

				let request = client.textRequest(text, {
					sessionId: session_model.id
				});

				console.debug(TAG, 'request', { text });

				request.on('response', (body) => {
					const action = body.result.action;

					// Edit msg from API.AI to reflect IO interface
					if (!_.isEmpty(body.result.fulfillment.messages)) {
						let msg = body.result.fulfillment.messages.getRandom();
						switch (msg.type) {
							case 0:
							break;
							case 2:
							body.result.fulfillment.data.replies = msg.replies;
							break;
							case 3:
							body.result.fulfillment.data = { image: { remoteFile: msg.imageUrl } };
							break;
							case 4:
							body.result.fulfillment.data = msg.payload;
							break;
							default:
							console.error(TAG, 'Type not recognized');
							break;
						}
						delete body.result.fulfillment.messages;
					}

					body.result.fulfillment.data = body.result.fulfillment.data || {};

					console.info(TAG, 'response', body);

					// If this action has not solved using webhook, reparse
					if (body.result.metadata.webhookUsed === "false") {
						if (body.result.actionIncomplete !== true && !_.isEmpty(action) && _.isFunction(Actions.list[ action ])) {
							console.warn(TAG, 'calling local action', action);
							AI.fulfillmentPromiseTransformer( Actions.list[ action ](), body, session_model )
							.then(resolve)
							.catch(reject);
						} else {
							console.debug(TAG, 'local resolution');
							AI.fulfillmentTransformer( body.result.fulfillment, session_model )
							.then(resolve);
						}
					} else {
						resolve(body.result.fulfillment);
					}
				});

				request.on('error', (err) => {
					console.error(TAG, 'error', err);
					reject(err);
				});

				request.end();

			});
		});
	});
};