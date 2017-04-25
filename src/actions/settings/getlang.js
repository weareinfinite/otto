exports.id = 'settings.switchlang';

module.exports = function({ sessionId, result }, session_model) {
	return new Promise((resolve, reject) => {
		let { parameters: p, fulfillment } = result;

		apprequire('translator').getLanguages(config.language, (err, avail_langs) => {
			if (err) return reject();

			const from = _.findWhere(avail_langs, { code: session_model.getTranslateFrom() }).name;
			const to = _.findWhere(avail_langs, { code: session_model.getTranslateTo() }).name;

			resolve({
				speech: `Ti sto parlando in ${to}, tu mi parli in ${from}`
			});
		});
	});
};