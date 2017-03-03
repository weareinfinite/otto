const TAG = 'IO.Kid';

exports.capabilities = { 
	TAG: TAG,
	userCanViewUrls: false
};

const Recorder = require('node-record-lpcm16');
const SpeechRecognizer = require(__basedir + '/support/speechrecognizer');
const FaceRecognizer = require(__basedir + '/support/facerecognizer');

const NodeWebcam = require('node-webcam');
const im = require('imagemagick');

const AWS = require('aws-sdk');
const s3 = new AWS.S3();

const tmpdir = require('os').tmpdir();

let callback;

let is_speaking = false;
let is_speaking_timeout = null;
const SPEAKING_TIMEOUT = 5000;

function captureWebcam() {
	if (captureWebcam.time + 10000 <= Date.now()) return;
	
	captureWebcam.time = Date.now();
	let file = tmpdir + '/webcam' + Date.now();

	NodeWebcam.capture(file, {
		delay: 0,
		quality: 100,
		output: "jpeg",
		verbose: true
	}, (err, image) => {
		if (err) return console.error(TAG, 'Error in capturing webcam');
		const file_resized = file + '-resized.jpg';

		im.resize({
			srcPath: image,
			dstPath: file_resized,
			width: 400
		}, (err, stdout, stderr) => {
			fs.unlinkSync(image);
			if (err) return console.error(TAG, 'Error in resizing image', err);

			const key = config.aws.s3.directory + '/webcam/' + Date.now() + '.jpg';
			s3.putObject({
				Bucket: config.aws.s3.bucket, 
				Key: key, 
				Body: fs.createReadStream(file_resized)
			}, (err) => {
				if (err) return console.error(TAG, 'Error in uploading image', err);

				FaceRecognizer.detect(`http://${config.aws.s3.bucket}.s3.amazonaws.com/${key}`, (err, resp) => {
					if (resp.length === 0) return console.error(TAG, 'Error in detect photo', err);

					FaceRecognizer.identify([ resp[0].faceId ], (err, resp) => {
						if (resp.length === 0 || resp[0] == null || resp[0].candidates.length === 0) return console.error(TAG, 'Error in face detection', err);

						let person_id = resp[0].candidates[0].personId;

						Memory.Contact.where({ person_id: person_id })
						.fetch({ required: true })
						.then((contact) => {
							if (captureWebcam.latestContactId == contact.id) return;
							captureWebcam.latestContactId = contact.id;

							const name = contact.get('alias') || contact.get('name');
							const responses = [
							`Hey ${name}, dimmi qualcosa!`,
							`Ciao ${name}, perchè non parli un po' con me?`,
							];

							console.log(responses);

							callback(null, {
								interrupt: true
							}, {
								answer: responses[_.random(0, responses.length-1)]
							});
						})
						.catch(() => {
							const responses = [ `Hey dimmi qualcosa!`, `Ciao perchè non parli un po' con me?`, ];
							callback(null, {
								interrupt: true
							}, {
								answer: responses[_.random(0, responses.length-1)]
							});
						});

					}); 
				}); 
			});
		});
	});
}

exports.onInput = function(cb) {
	callback = cb;
};

exports.startInput = function() {
	console.info(TAG, 'start');
	let data = {};

	if (is_speaking == false) {
		// captureWebcam();
	}

	let recorderStream = Recorder.start(_.extend({
		sampleRate: 16000,
		compress: false,
		threshold: 0.5,
		verbose: false,
	}, config.recorder));

	SpeechRecognizer.recognizeAudioStream(recorderStream, () => {
		if (is_speaking) {
			clearTimeout(is_speaking_timeout);
			is_speaking_timeout = setTimeout(() => { 
				console.debug(TAG, 'is not speaking with user anymore');
				is_speaking = false; 
			}, SPEAKING_TIMEOUT);
		}

		Recorder.stop();
	})
	.then((text) => {
		is_speaking = true;

		console.user(TAG, text);
		callback(null, data, {
			text: text
		});
	})
	.catch((err) => {
		console.error(TAG, err);
		callback(err, data);
	});
};

exports.output = function(data, e) {
	return new Promise((resolve, reject) => {
		console.ai(TAG, e);
		if (_.isString(e)) e = { text: e };

		if (e.error) return resolve();

		if (e.text) {
			return require('child_process').spawn(__basedir + '/out-speech.sh', [ e.text ])
			.addListener('exit', (err) => {
				if (err) return reject(err);
				resolve();
			});
		} 

		if (e.spotify) {
			let spotify_script = require('spotify-node-applescript');
			if (e.spotify.song) {
				return spotify_script.playTrack(e.spotify.song.uri, resolve);
			}
			if (e.spotify.action) {
				spotify_script[e.spotify.action]();
				return resolve();
			}
			return reject();
		}

		return reject();
	});
};