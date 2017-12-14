exports.id = 'shutdown.now';

const exec = require('child_process').exec;

module.exports = function({ sessionId, result }, session) {
	return new Promise(async(resolve, reject) => {
		let { parameters: p, fulfillment } = result;

		exec('shutdown now', (err, stdout, stderr) => {
			if (err) return reject(stderr);
			resolve({
				speech: fulfillment.speech,
				data: {
					stdout: stdout,
					feedback: true
				}
			});
		});
	});
};