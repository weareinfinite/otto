exports.id = 'lights.poweron';

const MIIO = apprequire('miio');

module.exports = function({ sessionId, result }, session_model) {
	return new Promise(async(resolve, reject) => {
		let { parameters: p, fulfillment } = result;
		resolve({
			speech: fulfillment.speech
		});
		const device = await MIIO.retrieveDefaultDevice();
		if (!device.power) await device.setPower(true);
		await device.setBrightness(Math.max(0, device.brightness - 30));
	});
};